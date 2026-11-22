import { describe, expect, it } from 'vitest';
import { evaluateSubscription } from '../../supabase/functions/_shared/play';

const NOW = Date.parse('2026-11-17T23:00:00Z');
const product = 'patrol_radar_pro';
const basePlanId = 'monthly';
const valid = {
  lineItems: [{ productId: product, offerDetails: { basePlanId }, expiryTime: new Date(NOW + 86400000).toISOString() }],
};
const v = (state: string, expiry = new Date(NOW + 86400000).toISOString()) =>
  evaluateSubscription({ ...valid, subscriptionState: state, lineItems: [{ productId: product, offerDetails: { basePlanId }, expiryTime: expiry }] }, NOW);

describe('Google Play server subscription rules', () => {
  it('accepts only verified active and in-grace purchases with future expiry', () => {
    expect(v('SUBSCRIPTION_STATE_ACTIVE').active).toBe(true);
    expect(v('SUBSCRIPTION_STATE_IN_GRACE_PERIOD').active).toBe(true);
    expect(v('SUBSCRIPTION_STATE_ACTIVE', new Date(NOW - 1).toISOString()).active).toBe(false);
  });
  it('keeps canceled access through paid expiry, then locks', () => {
    expect(v('SUBSCRIPTION_STATE_CANCELED').active).toBe(true);
    expect(v('SUBSCRIPTION_STATE_CANCELED', new Date(NOW - 1).toISOString()).active).toBe(false);
  });
  it.each(['SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_EXPIRED', 'SUBSCRIPTION_STATE_PAUSED',
    'SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'])(
    'denies %s even if expiry has not passed', state => {
      expect(v(state).active).toBe(false);
    });
  it('rejects wrong product or plan rather than unlocking any Play purchase', () => {
    expect(evaluateSubscription({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [
      { productId: 'unrelated_subscription', expiryTime: new Date(NOW + 86400000).toISOString() },
    ] }, NOW).active).toBe(false);
    expect(evaluateSubscription({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [
      { productId: product, offerDetails: { basePlanId: 'yearly' }, expiryTime: new Date(NOW + 86400000).toISOString() },
    ] }, NOW).active).toBe(false);
  });
  it('treats a free-trial subscription as active Pro until the trial expiry', () => {
    const status = evaluateSubscription({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
      lineItems: [{
        productId: product,
        expiryTime: new Date(NOW + 14 * 86400000).toISOString(),
        offerDetails: { basePlanId, offerId: 'free-trial-10d' },
      }],
    }, NOW);
    expect(status.active).toBe(true);
    expect(status.productMatches).toBe(true);
    expect(status.needsAcknowledge).toBe(true);
    expect(status.expiresAt).toBe(new Date(NOW + 14 * 86400000).toISOString());
  });
  it('reports pending acknowledgement for fulfilled active purchases', () => {
    const status = evaluateSubscription({
      ...valid,
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    }, NOW);
    expect(status.active).toBe(true);
    expect(status.needsAcknowledge).toBe(true);
  });
});
