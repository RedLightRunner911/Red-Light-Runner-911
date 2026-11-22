import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import { sha256, playSubscription, evaluateSubscription, acknowledgeSubscription, PRODUCT } from './play.ts';
import {
  decideOwnership, founderAutoClaimEnabled, isAccountHash, isOwnershipRaceError, LINKED_ELSEWHERE, plausibleFounderInstall, SERVER_VERIFIED_TTL_MS,
} from './ownership.ts';

export function admin() {
  const url = Deno.env.get('SUPABASE_URL');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !secret) throw new Error('Supabase service configuration missing');
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function authenticatedUser(jwt: string) {
  const { data, error } = await admin().auth.getUser(jwt);
  if (error || !data.user?.id) throw new Error('Authentication required');
  return data.user.id as string;
}

/** Check every grant against Google. A purchase token alone never grants privileges. */
export async function refreshToken(token: string, presentedBy?: string, presentedAccountHash?: string | null) {
  const db = admin();
  const tokenHash = await sha256(token);
  const subscription = await playSubscription(token);
  const verdict = evaluateSubscription(subscription);
  if (!verdict.productMatches) throw new Error('This purchase is not Patrol Radar Pro');
  const { data: previous, error: previousError } = await db.from('pro_purchases').select('user_id')
    .eq('token_sha256', tokenHash).maybeSingle();
  if (previousError) throw new Error('Could not check purchase ownership');
  // Google's linked token can belong to an existing subscriber after a plan change.
  // Do not let a new caller claim the replacement token before RTDN arrives.
  let linkedOwner: string | null = null;
  if (verdict.linkedPurchaseToken) {
    const linkedHash = await sha256(verdict.linkedPurchaseToken);
    const { data: linked, error: linkedError } = await db.from('pro_purchases').select('user_id')
      .eq('token_sha256', linkedHash).maybeSingle();
    if (linkedError) throw new Error('Could not check linked purchase ownership');
    linkedOwner = linked?.user_id ?? null;
  }
  // A token is not transferable just because a new anonymous account presents it. The only
  // takeover is reinstall recovery proven by Google's obfuscatedExternalAccountId (ownership.ts).
  const decision = decideOwnership({
    previousOwner: previous?.user_id ?? null, linkedOwner, presentedBy,
    presentedAccountHash, googleAccountHash: verdict.googleAccountHash,
  });
  // RTDN can arrive before the device sends its first verified purchase.
  if (decision.kind === 'skip') return null;
  let owner: string;
  if (decision.kind === 'relink') {
    const { data: moved, error: relinkError } = await db.rpc('relink_pro_purchase',
      { p_token_sha256: tokenHash, p_from: decision.from, p_to: decision.to });
    if (relinkError) throw new Error('Unable to move subscription to this install');
    if (!moved) throw new Error(LINKED_ELSEWHERE); // owner changed underneath us
    owner = decision.to;
  } else owner = decision.owner;
  const { error } = await db.from('pro_purchases').upsert({
    token_sha256: tokenHash, purchase_token: token, user_id: owner,
    product_id: PRODUCT, state: verdict.state, active: verdict.active,
    expires_at: verdict.expiresAt, verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'token_sha256' });
  // Database trigger rejects competing first claims that raced between our read and upsert.
  if (error) throw new Error(isOwnershipRaceError(error.message) ? LINKED_ELSEWHERE : 'Unable to persist subscription verification');
  // Ack only AFTER the trusted database has recorded fulfillment.
  if (verdict.active && verdict.needsAcknowledge) {
    try { await acknowledgeSubscription(token); }
    catch { console.warn('Google subscription acknowledgement retry required'); }
  }
  return verdict;
}

/**
 * Record a permanent founder grant for a local Android founder, or recover one after a reinstall
 * on the same phone (matching account hash). TRUST: install time is self-reported by the app.
 * Off unless FOUNDER_AUTO_CLAIM is on, true, 1, or yes. The one-time founder code is unaffected.
 * TODO(play-integrity): require a Play Integrity verdict (MEETS_DEVICE_INTEGRITY + PLAY_RECOGNIZED)
 * before granting once the Integrity API is enabled for this app.
 */
export async function claimFounderInstall(userId: string, firstInstallMs: unknown, accountHash: unknown) {
  if (!founderAutoClaimEnabled(Deno.env.get('FOUNDER_AUTO_CLAIM'))) return proStatus(userId);
  const installAt = plausibleFounderInstall(firstInstallMs) ? new Date(firstInstallMs).toISOString() : null;
  const hash = isAccountHash(accountHash) ? accountHash : null;
  if (!installAt && !hash) return proStatus(userId);
  const { error } = await admin().rpc('claim_pro_founder_install',
    { p_uid: userId, p_first_install: installAt, p_account_hash: hash });
  if (error) throw new Error('Could not record founding tester access');
  return proStatus(userId);
}

export async function proStatus(userId: string) {
  const db = admin();
  const { data: founder, error: founderError } = await db.from('pro_founders')
    .select('user_id').eq('user_id', userId).maybeSingle();
  if (founderError) throw new Error('Could not read founding entitlement');
  if (founder) return { pro: true, foundingTester: true, source: 'founder', expiresAt: null };
  const { data: purchases, error } = await db.from('pro_purchases')
    .select('purchase_token').eq('user_id', userId).order('verified_at', { ascending: false }).limit(10);
  if (error) throw new Error('Could not read subscription entitlements');
  for (const row of purchases ?? []) {
    // Re-read Play on user return. RTDN also keeps status fresh between launches.
    try { await refreshToken(row.purchase_token); } catch { /* fall back to the recent Google-verified row */ }
  }
  // A Google outage must not drop paying users. Rows verified in the last 3 days still count until
  // their Google expiry; refunds/revocations arrive by RTDN and flip `active` immediately.
  const staleAfter = new Date(Date.now() - SERVER_VERIFIED_TTL_MS).toISOString();
  const { data: valid, error: validError } = await db.from('pro_purchases')
    .select('expires_at').eq('user_id', userId).eq('active', true)
    .gt('expires_at', new Date().toISOString()).gte('verified_at', staleAfter)
    .order('expires_at', { ascending: false }).limit(1);
  if (validError) throw new Error('Could not check subscription entitlement');
  if (!valid?.length) return { pro: false, foundingTester: false, source: 'none', expiresAt: null };
  return { pro: true, foundingTester: false, source: 'play', expiresAt: valid[0].expires_at };
}
