/**
 * Effective Pro on this device = Android founder (install date) OR server-verified Pro OR, only while the
 * server cannot be reached, the last server-verified status cached on this device.
 *
 * The web app never grants Pro: no founder unlock, no cache, and it never contacts the verifier.
 */
import type { EntitlementPlatform } from './pro';

export const PRO_CACHE_KEY = 'pr.pro.verified';
/** Keep honoring a cached Play subscription this long after Google's expiry while offline (renewals land late). */
export const PLAY_OFFLINE_GRACE_MS = 3 * 24 * 3600_000;

export interface VerifiedStatus {
  pro: boolean;
  foundingTester: boolean;
  expiresAt: string | null;
  source: 'founder' | 'play' | 'none';
}

interface CachedStatus { pro: true; source: 'founder' | 'play'; expiresAt: string | null; verifiedAt: number }

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Save an authoritative server answer. A server "not Pro" answer clears the cache. */
export function saveVerifiedStatus(store: KeyValueStore | undefined, status: VerifiedStatus, now = Date.now()): void {
  if (!store) return;
  try {
    if (!status.pro || status.source === 'none') { store.removeItem(PRO_CACHE_KEY); return; }
    const row: CachedStatus = { pro: true, source: status.source, expiresAt: status.expiresAt, verifiedAt: now };
    store.setItem(PRO_CACHE_KEY, JSON.stringify(row));
  } catch { /* storage blocked: no offline cache */ }
}

/** Cached Pro still honored offline? Founder grants are permanent; Play grants last until expiry + grace. */
export function cachedProValid(store: KeyValueStore | undefined, platform: EntitlementPlatform, now = Date.now()): VerifiedStatus | null {
  if (platform !== 'android' || !store) return null;
  let row: Partial<CachedStatus> | null = null;
  try { row = JSON.parse(store.getItem(PRO_CACHE_KEY) ?? 'null'); } catch { return null; }
  if (!row || row.pro !== true || typeof row.verifiedAt !== 'number' || row.verifiedAt > now + 60_000) return null;
  if (row.source === 'founder') return { pro: true, foundingTester: true, expiresAt: null, source: 'founder' };
  if (row.source !== 'play') return null;
  const expiry = Date.parse(row.expiresAt ?? '');
  if (!Number.isFinite(expiry) || now > expiry + PLAY_OFFLINE_GRACE_MS) return null;
  return { pro: true, foundingTester: false, expiresAt: row.expiresAt ?? null, source: 'play' };
}

export interface AccessInputs {
  platform: EntitlementPlatform;
  /** Install-date founder from loadProEntitlement (Android only). */
  localFounder: boolean;
  /** Last server answer this launch; null while unknown or unreachable. */
  server: VerifiedStatus | null;
  /** Result of cachedProValid; consulted only when server is null. */
  cached: VerifiedStatus | null;
}

export function effectiveAccess(i: AccessInputs): { pro: boolean; foundingTester: boolean; source: 'founder' | 'play' | 'local-founder' | 'cache' | 'none' } {
  if (i.platform !== 'android') return { pro: false, foundingTester: false, source: 'none' };
  if (i.server?.pro) return { pro: true, foundingTester: i.server.foundingTester || i.localFounder, source: i.server.source === 'founder' ? 'founder' : 'play' };
  if (i.localFounder) return { pro: true, foundingTester: true, source: 'local-founder' };
  if (!i.server && i.cached?.pro) return { pro: true, foundingTester: i.cached.foundingTester, source: 'cache' };
  return { pro: false, foundingTester: false, source: 'none' };
}

/** Friendly copy for verifier errors (the server already returns readable text for known cases). */
export function restoreNotice(errors: string[], status: VerifiedStatus): string | undefined {
  if (status.pro || errors.length === 0) return undefined;
  return errors[0];
}
