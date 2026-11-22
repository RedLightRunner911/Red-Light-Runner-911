/**
 * Pure purchase-ownership rules. No Deno, network or database access so they can be unit tested.
 *
 * A Play purchase token belongs to the first Patrol Radar account that verified it. A different
 * account may take it over ONLY when Google itself reports that the purchase was made with the
 * obfuscated account id that the presenting device also proves it holds (a SHA-256 of the
 * per-app Android ID, set via BillingFlowParams.setObfuscatedAccountId at checkout). That is the
 * reinstall case: a new anonymous Supabase user on the same phone.
 */
export const LINKED_ELSEWHERE = 'Purchase already linked to another account';
export const LINKED_ELSEWHERE_HELP =
  'This Google Play subscription is linked to a different Patrol Radar install. ' +
  'Restore it on the phone you bought it on, or contact support with your Google Play order number.';
export const CONFLICTING_OWNERSHIP = 'Conflicting purchase ownership';

const HASH = /^[a-f0-9]{64}$/;
export function isAccountHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}

export interface OwnershipInput {
  /** Current owner of this token, if any. */
  previousOwner: string | null;
  /** Owner of Google's linkedPurchaseToken (plan change / resubscribe), if any. */
  linkedOwner: string | null;
  /** Authenticated caller. Undefined for RTDN / server refresh. */
  presentedBy?: string;
  /** Account hash the calling device presents. */
  presentedAccountHash?: string | null;
  /** obfuscatedExternalAccountId Google returned for this purchase. */
  googleAccountHash?: string | null;
}

export type OwnershipDecision =
  | { kind: 'skip' }                                  // RTDN before any device verified it
  | { kind: 'owner'; owner: string }                  // insert/update under this owner
  | { kind: 'relink'; from: string; to: string };     // verified reinstall recovery

export function decideOwnership(i: OwnershipInput): OwnershipDecision {
  let owner = i.previousOwner;
  if (i.linkedOwner) {
    if (owner && owner !== i.linkedOwner) throw new Error(CONFLICTING_OWNERSHIP);
    owner = i.linkedOwner;
  }
  if (i.presentedBy && owner && owner !== i.presentedBy) {
    const proven = isAccountHash(i.presentedAccountHash) && isAccountHash(i.googleAccountHash) &&
      i.presentedAccountHash === i.googleAccountHash;
    // Only an existing row can be relinked. A linked-token owner without its own row keeps it.
    if (proven && i.previousOwner === owner) return { kind: 'relink', from: owner, to: i.presentedBy };
    throw new Error(LINKED_ELSEWHERE);
  }
  owner = owner ?? i.presentedBy ?? null;
  return owner ? { kind: 'owner', owner } : { kind: 'skip' };
}

/** Postgres raised by the pro_purchase_owner_immutable trigger when a concurrent claim lost. */
export function isOwnershipRaceError(message: string | undefined | null): boolean {
  return typeof message === 'string' && message.includes('ownership cannot be reassigned');
}

/** Founding-tester cutoff: installs strictly before this qualify. Mirrors src/entitlement/pro.ts. */
export const FOUNDER_CUTOFF_MS = Date.parse('2026-11-16T19:54:00-06:00');
/** Reject obviously bogus install times (before the Patrol Radar repo existed, Oct 2026). */
export const FOUNDER_FLOOR_MS = Date.parse('2026-10-01T00:00:00Z');

export function plausibleFounderInstall(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= FOUNDER_FLOOR_MS && ms < FOUNDER_CUTOFF_MS;
}

/**
 * Founder auto-claim is off unless FOUNDER_AUTO_CLAIM is explicitly enabled.
 * Unset, empty, "off", "0", and "false" all stay off. The one-time code path is separate.
 */
export function founderAutoClaimEnabled(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Server keeps a subscription grant without a fresh Google read for this long (RTDN keeps it current). */
export const SERVER_VERIFIED_TTL_MS = 3 * 24 * 3600_000;
