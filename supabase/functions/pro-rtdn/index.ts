import { verifyPubSubPush, PACKAGE } from '../_shared/play.ts';
import { refreshToken } from '../_shared/store.ts';

/**
 * Google Play Real-time Developer Notifications via authenticated Pub/Sub push.
 * Must NOT be a public unauthenticated webhook: validate the Google OIDC token.
 * Pub/Sub events are hints; Google Play subscriptionsv2.get is always source of truth.
 */
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    if (!await verifyPubSubPush(req)) return new Response('Unauthorized', { status: 401 });
    const raw = await req.text();
    if (raw.length > 25000) return new Response('Too large', { status: 413 });
    const payload = JSON.parse(raw);
    if (typeof payload.message?.data !== 'string') return new Response('Bad message', { status: 400 });
    const data = JSON.parse(atob(payload.message.data));
    if (data.packageName !== PACKAGE) return new Response('Unrelated app', { status: 200 });
    const token = data.subscriptionNotification?.purchaseToken;
    if (typeof token !== 'string') return new Response('No subscription update', { status: 200 });
    await refreshToken(token);
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('RTDN processing failed: ', (e as Error).message.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]'));
    // Non-2xx makes Pub/Sub redeliver after transient Google/DB outage.
    return new Response('Retry', { status: 503 });
  }
});
