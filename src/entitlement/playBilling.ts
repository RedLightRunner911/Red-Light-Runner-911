import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { restoreNotice } from './proAccess';

/** Billing has its own anonymous session so chat sign-out or chat storage resets never orphan a purchase. */
export const PRO_AUTH_STORAGE_KEY = 'pr.pro.auth';

export interface PlayPurchase {
  productId: string;
  purchaseToken: string;
  state: 'purchased' | 'pending' | 'unknown';
}
export interface ProStatus {
  pro: boolean;
  foundingTester: boolean;
  expiresAt: string | null;
  source: 'founder' | 'play' | 'none';
}
export interface PlayProduct {
  productId: string;
  basePlanId: string;
  price: string;
  currencyCode: string;
  /** True when Play returned the eligible free-trial offer for this account. */
  freeTrial?: boolean;
  offerId?: string | null;
}

/** Paywall strings. The trial line is empty unless Play offered the 14-day trial. */
export function subscriptionOfferCopy(product: { price: string; freeTrial?: boolean }): { priceLabel: string; button: string; trialNote: string } {
  if (product.freeTrial) {
    return {
      priceLabel: product.price + '/month after trial',
      button: 'Start 2-week free trial',
      trialNote: 'Includes a 2-week free trial. You will not be charged until the trial ends. Cancel anytime in Google Play before then and you will not be billed.',
    };
  }
  return { priceLabel: product.price + '/month', button: 'Subscribe with Google Play', trialNote: '' };
}
type NativeBilling = {
  getProduct(): Promise<PlayProduct>;
  purchase(): Promise<{ launched: boolean }>;
  restore(): Promise<{ purchases: PlayPurchase[] }>;
  account?(): Promise<{ accountHash?: string | null }>;
  addListener(name: string, callback: (event: any) => void): Promise<{ remove(): Promise<void> }>;
};
const PRODUCT = 'patrol_radar_pro';
export type RestoreResult = ProStatus & { notice?: string };
const EMPTY: ProStatus = { pro: false, foundingTester: false, expiresAt: null, source: 'none' };

export function nativeBilling(): NativeBilling | undefined {
  const cap = (globalThis as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return undefined;
  return cap.Plugins?.PlayBilling ?? cap.registerPlugin?.('PlayBilling');
}

export class PlayProClient {
  private constructor(
    private readonly sb: SupabaseClient,
    private readonly endpoint: string,
    readonly native: NativeBilling | undefined,
  ) {}
  static async create(): Promise<PlayProClient> {
    const url = import.meta.env.VITE_SUPABASE_URL?.trim();
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
    if (!url || !key) throw new Error('Subscriptions are not configured yet.');
    const sb = createClient(url, key, { auth: { persistSession: true, storageKey: PRO_AUTH_STORAGE_KEY } });
    const session = await sb.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session) {
      const signed = await sb.auth.signInAnonymously();
      if (signed.error) throw signed.error;
    }
    return new PlayProClient(sb, url.replace(/\/$/, '') + '/functions/v1/pro-entitlement', nativeBilling());
  }
  private accountHashValue: string | null | undefined;
  /** SHA-256 checkout account id from the native plugin (same value passed to setObfuscatedAccountId). */
  async accountHash(): Promise<string | null> {
    if (this.accountHashValue !== undefined) return this.accountHashValue;
    try {
      const v = (await this.native?.account?.())?.accountHash;
      this.accountHashValue = typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : null;
    } catch { this.accountHashValue = null; }
    return this.accountHashValue;
  }
  private async request(action: string, extra: Record<string, unknown> = {}): Promise<ProStatus> {
    const { data, error } = await this.sb.auth.getSession();
    if (error || !data.session) throw new Error('Sign in to restore your subscription.');
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + data.session.access_token,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...extra }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not verify with Google Play.');
    if (typeof body.pro !== 'boolean' || typeof body.foundingTester !== 'boolean') throw new Error('Invalid entitlement response.');
    return { ...EMPTY, ...body };
  }
  async status(): Promise<ProStatus> { return this.request('status'); }
  async verify(p: PlayPurchase): Promise<ProStatus> {
    if (p.state !== 'purchased' || p.productId !== PRODUCT || !p.purchaseToken) return this.status();
    return this.request('verify', { purchaseToken: p.purchaseToken, accountHash: await this.accountHash() });
  }
  async getProduct(): Promise<PlayProduct> {
    if (!this.native) throw new Error('Google Play purchases require the Android app.');
    return this.native.getProduct();
  }
  async purchase(): Promise<void> {
    if (!this.native) throw new Error('Google Play purchases require the Android app.');
    await this.native.purchase();
    // The purchaseUpdated callback contains the token. Never grant Pro here.
  }
  async restore(): Promise<RestoreResult> {
    if (!this.native) return this.status();
    return restorePurchases((await this.native.restore()).purchases ?? [], p => this.verify(p), () => this.status());
  }
  /**
   * Automatic founder migration (Android only): records a permanent server grant for an install made
   * before the founding cutoff, or recovers one after a reinstall on the same phone.
   */
  async claimFounderInstall(firstInstallTime: number | null): Promise<ProStatus> {
    return this.request('founder-install', { firstInstallTime, accountHash: await this.accountHash() });
  }
  async redeemFounderCode(code: string): Promise<ProStatus> {
    if (!/^[A-Za-z0-9-]{16,96}$/.test(code.trim())) throw new Error('Invalid founding tester code.');
    return this.request('founder', { founderCode: code.trim() });
  }
  async listen(onVerified: (status: ProStatus) => void, onNotice: (message: string) => void) {
    if (!this.native) return;
    await this.native.addListener('purchaseUpdated', async (purchase: PlayPurchase) => {
      if (purchase.state === 'pending') { onNotice('Payment pending in Google Play. Pro remains locked.'); return; }
      try { onVerified(await this.verify(purchase)); }
      catch (error) { onNotice((error as Error).message); }
    });
    await this.native.addListener('purchaseError', (event: { cancelled?: boolean; code?: number }) => {
      if (!event.cancelled) onNotice('Google Play checkout could not complete. Please retry.');
    });
  }
}

/**
 * Verify every restorable purchase. One bad token must not block another valid one, but when nothing
 * unlocks, the verifier's reason (e.g. linked to another install) is returned instead of being swallowed.
 */
export async function restorePurchases(
  purchases: PlayPurchase[],
  verify: (p: PlayPurchase) => Promise<ProStatus>,
  status: () => Promise<ProStatus>,
): Promise<RestoreResult> {
  const errors: string[] = [];
  for (const purchase of purchases) {
    if (purchase.state !== 'purchased' || purchase.productId !== PRODUCT) continue;
    try { await verify(purchase); } catch (e) { errors.push((e as Error).message); }
  }
  const final = await status();
  const notice = restoreNotice(errors, final);
  return notice ? { ...final, notice } : final;
}
