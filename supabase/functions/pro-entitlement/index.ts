import { admin, authenticatedUser, claimFounderInstall, proStatus, refreshToken } from '../_shared/store.ts';
import { CONFLICTING_OWNERSHIP, LINKED_ELSEWHERE, LINKED_ELSEWHERE_HELP } from '../_shared/ownership.ts';
import { sha256 } from '../_shared/play.ts';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

/** Set verify_jwt = false in Supabase config: this handler checks access tokens with GoTrue. */
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const jwt = /^Bearer ([-\w.]+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!jwt) return json(401, { error: 'Authentication required' });
    const userId = await authenticatedUser(jwt);
    const raw = await req.text();
    if (raw.length > 10000) return json(413, { error: 'Request too large' });
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request' });
    if (body.action === 'status') return json(200, await proStatus(userId));
    if (body.action === 'verify') {
      if (typeof body.purchaseToken !== 'string') return json(400, { error: 'Missing purchase token' });
      await refreshToken(body.purchaseToken, userId,
        typeof body.accountHash === 'string' ? body.accountHash : null);
      return json(200, await proStatus(userId));
    }
    if (body.action === 'founder-install') {
      // Android-only automatic founder migration; see claimFounderInstall for the trust model.
      return json(200, await claimFounderInstall(userId, body.firstInstallTime, body.accountHash));
    }
    if (body.action === 'founder') {
      if (typeof body.founderCode !== 'string' ||
          !/^[A-Za-z0-9-]{16,96}$/.test(body.founderCode))
        return json(400, { error: 'Invalid founding tester code' });
      const digest = await sha256(body.founderCode);
      const { data, error } = await admin().rpc('claim_pro_founder_code',
        { p_uid: userId, p_code_sha256: digest });
      if (error) throw new Error('Could not validate founding tester access');
      if (!data) return json(403, { error: 'Code already used, invalid, or expired' });
      return json(200, await proStatus(userId));
    }
    return json(400, { error: 'Unknown action' });
  } catch (e) {
    const message = (e as Error).message ?? '';
    // Do not leak purchase tokens, service credentials, user IDs or remote API bodies.
    if (message === 'Authentication required') return json(401, { error: message });
    if (message === LINKED_ELSEWHERE || message === CONFLICTING_OWNERSHIP)
      return json(409, { error: LINKED_ELSEWHERE_HELP, code: 'linked_elsewhere' });
    if (message === 'Google Play does not recognize this purchase' ||
        message === 'This purchase is not Patrol Radar Pro' ||
        message === 'Invalid Play purchase token') return json(400, { error: message });
    console.error('Pro verification error:', message.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]'));
    return json(503, { error: 'Subscription verification is temporarily unavailable. Please retry.' });
  }
});
