import { describe, expect, it } from 'vitest';
import { cachedProValid, effectiveAccess, PLAY_OFFLINE_GRACE_MS, PRO_CACHE_KEY, saveVerifiedStatus, type VerifiedStatus } from './proAccess';
import { loadProEntitlement, TESTER_CUTOFF_MS, trafficCameraAlertUnlocked, trafficCamerasUnlocked } from './pro';
import { restorePurchases, type PlayPurchase } from './playBilling';

const NOW = Date.parse('2026-12-01T12:00:00Z');
const mem = () => { const m = new Map<string, string>(); return {
  getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m,
}; };
const none: VerifiedStatus = { pro: false, foundingTester: false, expiresAt: null, source: 'none' };
const play = (expiresAt: string): VerifiedStatus => ({ pro: true, foundingTester: false, expiresAt, source: 'play' });
const founder: VerifiedStatus = { pro: true, foundingTester: true, expiresAt: null, source: 'founder' };

describe('effective Pro access', () => {
  it('keeps install-date founders on Pro with no server answer (offline / Supabase down)', async () => {
    const hint = await loadProEntitlement({ platform: 'android', readInstallTime: async () => TESTER_CUTOFF_MS - 1, storage: mem(), clientFlagsAllowed: true });
    const access = effectiveAccess({ platform: 'android', localFounder: hint.foundingTester, server: null, cached: null });
    expect(access).toMatchObject({ pro: true, foundingTester: true, source: 'local-founder' });
    expect(trafficCamerasUnlocked(access)).toBe(true);
  });
  it('keeps founders on Pro even when the server says not Pro', () => {
    expect(effectiveAccess({ platform: 'android', localFounder: true, server: none, cached: null }).pro).toBe(true);
  });
  it('unlocks verified Play subscribers and locks everyone else', () => {
    expect(effectiveAccess({ platform: 'android', localFounder: false, server: play('2026-12-20T00:00:00Z'), cached: null }).pro).toBe(true);
    const free = effectiveAccess({ platform: 'android', localFounder: false, server: none, cached: null });
    expect(free.pro).toBe(false);
    expect(trafficCamerasUnlocked(free)).toBe(false);
    expect(trafficCameraAlertUnlocked(free, 'school_zone')).toBe(true);
    expect(trafficCameraAlertUnlocked(free, 'work_zone')).toBe(true);
    expect(trafficCameraAlertUnlocked(free, 'speed')).toBe(false);
  });
  it('never grants Pro on the web, whatever the inputs', () => {
    expect(effectiveAccess({ platform: 'web', localFounder: true, server: founder, cached: founder }).pro).toBe(false);
    const s = mem(); saveVerifiedStatus(s, founder, NOW);
    expect(cachedProValid(s, 'web', NOW)).toBeNull();
  });
  it('uses the cache only when the server is unreachable; an authoritative "not Pro" wins', () => {
    const cached = play('2026-12-20T00:00:00Z');
    expect(effectiveAccess({ platform: 'android', localFounder: false, server: null, cached }).pro).toBe(true);
    expect(effectiveAccess({ platform: 'android', localFounder: false, server: none, cached }).pro).toBe(false);
  });
});

describe('offline Pro cache', () => {
  it('honors a cached Play subscription until expiry plus grace, then locks', () => {
    const s = mem(); const expiry = '2026-12-05T00:00:00Z';
    saveVerifiedStatus(s, play(expiry), NOW);
    expect(cachedProValid(s, 'android', Date.parse(expiry) + PLAY_OFFLINE_GRACE_MS - 1)?.pro).toBe(true);
    expect(cachedProValid(s, 'android', Date.parse(expiry) + PLAY_OFFLINE_GRACE_MS + 1)).toBeNull();
  });
  it('keeps a cached server founder grant indefinitely', () => {
    const s = mem(); saveVerifiedStatus(s, founder, NOW);
    expect(cachedProValid(s, 'android', NOW + 365 * 86400000)).toMatchObject({ pro: true, foundingTester: true });
  });
  it('clears on an authoritative "not Pro" and ignores junk or future-dated rows', () => {
    const s = mem(); saveVerifiedStatus(s, founder, NOW); saveVerifiedStatus(s, none, NOW);
    expect(s.m.has(PRO_CACHE_KEY)).toBe(false);
    s.setItem(PRO_CACHE_KEY, '{not json'); expect(cachedProValid(s, 'android', NOW)).toBeNull();
    s.setItem(PRO_CACHE_KEY, JSON.stringify({ pro: true, source: 'founder', verifiedAt: NOW + 86400000 }));
    expect(cachedProValid(s, 'android', NOW)).toBeNull();
    s.setItem(PRO_CACHE_KEY, JSON.stringify({ pro: true, source: 'play', expiresAt: null, verifiedAt: NOW }));
    expect(cachedProValid(s, 'android', NOW)).toBeNull();
  });
});

describe('restore surfaces verifier errors', () => {
  const p = (token: string): PlayPurchase => ({ productId: 'patrol_radar_pro', purchaseToken: token, state: 'purchased' });
  it('returns the linked-elsewhere reason instead of silently staying free', async () => {
    const r = await restorePurchases([p('aaaaaaaa')], async () => { throw new Error('Linked to a different install'); }, async () => none);
    expect(r).toMatchObject({ pro: false, notice: 'Linked to a different install' });
  });
  it('one bad token does not block another valid purchase, and no notice once Pro', async () => {
    const verified: string[] = [];
    const r = await restorePurchases([p('bad-token'), p('good-token')], async x => {
      if (x.purchaseToken === 'bad-token') throw new Error('nope');
      verified.push(x.purchaseToken); return play('2026-12-20T00:00:00Z');
    }, async () => play('2026-12-20T00:00:00Z'));
    expect(verified).toEqual(['good-token']);
    expect(r.pro).toBe(true);
    expect(r.notice).toBeUndefined();
  });
  it('skips pending and foreign purchases', async () => {
    let calls = 0;
    await restorePurchases([{ ...p('x1234567'), state: 'pending' }, { ...p('y1234567'), productId: 'other' }],
      async () => { calls++; return none; }, async () => none);
    expect(calls).toBe(0);
  });
});
