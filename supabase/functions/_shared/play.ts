/** Google Play Publisher API client. Never bundle this module into the Android/web app. */
declare const Deno: { env: { get(key: string): string | undefined } };
export const PACKAGE = 'io.github.missionaryj.patrolradar';
export const PRODUCT = 'patrol_radar_pro';
export const BASE_PLAN = 'monthly';

type Subscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    offerDetails?: { basePlanId?: string; offerId?: string };
  }>;
};

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}

async function getAccessToken(): Promise<string> {
  const raw = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('Play service credentials are not configured');
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key) throw new Error('Invalid Google service credentials');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3500,
  }));
  const unencodedKey = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = Uint8Array.from(atob(unencodedKey), x => x.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signingInput = header + '.' + payload;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)));
  const assertion = signingInput + '.' + base64url(signature);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('Google service-account authentication failed');
  const body = await response.json();
  if (typeof body.access_token !== 'string') throw new Error('Google OAuth response missing access token');
  return body.access_token;
}

async function googleApi(url: string, token: string, method = 'GET'): Promise<Response> {
  const auth = await getAccessToken();
  return fetch(url, { method, headers: {
    Authorization: 'Bearer ' + auth,
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
  }, ...(method === 'POST' ? { body: '{}' } : {}) });
}

export async function playSubscription(purchaseToken: string): Promise<Subscription> {
  if (purchaseToken.length < 8 || purchaseToken.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(purchaseToken))
    throw new Error('Invalid Play purchase token');
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE) + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(purchaseToken);
  const response = await googleApi(url, purchaseToken);
  if (!response.ok) {
    if (response.status === 400 || response.status === 404 || response.status === 410)
      throw new Error('Google Play does not recognize this purchase');
    throw new Error('Google Play verification unavailable');
  }
  return await response.json();
}

export function evaluateSubscription(s: Subscription, now = Date.now()) {
  const items = (s.lineItems ?? []).filter(item =>
    item.productId === PRODUCT && (!item.offerDetails?.basePlanId || item.offerDetails.basePlanId === BASE_PLAN));
  const expiry = Math.max(0, ...items.map(item => Date.parse(item.expiryTime ?? '') || 0));
  const state = s.subscriptionState ?? 'UNKNOWN';
  // A free trial (offer id free-trial-10d) is SUBSCRIPTION_STATE_ACTIVE until expiryTime,
  // which Google sets to the end of the trial. RTDN uses this same function via refreshToken.
  const stateEligible = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED'].includes(state);
  return {
    active: stateEligible && expiry > now,
    expiresAt: expiry ? new Date(expiry).toISOString() : null,
    state,
    productMatches: items.length > 0,
    linkedPurchaseToken: s.linkedPurchaseToken ?? null,
    /** setObfuscatedAccountId value from checkout, as reported by Google (not by the device). */
    googleAccountHash: s.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    needsAcknowledge: s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
  };
}

export async function acknowledgeSubscription(token: string) {
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE) + '/purchases/subscriptions/' + PRODUCT + '/tokens/' + encodeURIComponent(token) + ':acknowledge';
  const result = await googleApi(url, token, 'POST');
  if (!result.ok) throw new Error('Play acknowledgement failed (' + result.status + ')');
}

/** Google Pub/Sub authenticated push: check Google-issued OIDC ID token and exact audience/service account. */
export async function verifyPubSubPush(req: Request): Promise<boolean> {
  const expectedEmail = Deno.env.get('GOOGLE_PUBSUB_PUSH_EMAIL');
  const expectedAudience = Deno.env.get('GOOGLE_PUBSUB_AUDIENCE');
  const jwt = /^Bearer ([-\w.]+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!expectedEmail || !expectedAudience || !jwt) return false;
  const check = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(jwt));
  if (!check.ok) return false;
  const token = await check.json();
  return (token.iss === 'https://accounts.google.com' || token.iss === 'accounts.google.com') && token.aud === expectedAudience &&
    token.email === expectedEmail && String(token.email_verified) === 'true';
}
