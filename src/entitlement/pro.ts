/**
 * Local Pro hints.
 *
 * Paid Play access is not decided here. PlayBillingPlugin starts Google Play checkout,
 * and proAccess.ts grants Pro from a server-verified subscription (or a cached server
 * answer while the verifier cannot be reached). This module never reads a purchase
 * from localStorage, the URL, or the page, and it does not talk to Play Billing.
 *
 * Client-side founding-tester flags (install time and pr.foundingTester) grant Pro
 * only when the caller passes clientFlagsAllowed. The app sets that only for a
 * non-debuggable build installed by Google Play. Debug builds, sideloaded builds,
 * and the web app do not grant Pro from those flags.
 */

/** Open testing resumed at 2026-11-16T19:54:00-06:00. Installs strictly before this are founding testers. */
export const TESTER_CUTOFF_MS = Date.parse('2026-11-16T19:54:00-06:00');

/** Written only after an Android install qualifies. Not a purchase receipt. */
export const FOUNDING_TESTER_KEY = 'pr.foundingTester';

export const FOUNDING_TESTER_LABEL = 'Founding tester: Pro unlocked';

export type EntitlementPlatform = 'android' | 'web';

export interface EntitlementSources {
  platform: EntitlementPlatform;
  /** PackageInfo.firstInstallTime in epoch ms, or null when the bridge did not return one. */
  firstInstallTimeMs: number | null;
  /** True when this Android install already stored a founding-tester grant. */
  persistedGrant: boolean;
  /**
   * True only for a non-debuggable Google Play install (see clientFounderFlagsAllowed).
   * When false, install time and pr.foundingTester do not grant Pro.
   */
  clientFlagsAllowed?: boolean;
  /**
   * Server-checked Play entitlement. The app does not pass this; paid Pro is applied
   * in proAccess.ts from the verifier. Never load it from localStorage.
   */
  verifiedPurchase?: boolean;
}

export interface ProEntitlement {
  pro: boolean;
  foundingTester: boolean;
}

export interface GrantStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Strictly before the cutoff. The cutoff instant itself does not qualify. */
export function qualifiesByInstallDate(firstInstallTimeMs: number | null, cutoffMs = TESTER_CUTOFF_MS): boolean {
  return typeof firstInstallTimeMs === 'number' && Number.isFinite(firstInstallTimeMs) && firstInstallTimeMs < cutoffMs;
}

/** Installer package for an app installed by Google Play (internal, closed, open, or production). */
export const PLAY_INSTALLER = 'com.android.vending';

/**
 * Client-side founder flags are honored only on a release build installed by Play.
 * A debuggable build (WebView debugging) or any sideload returns false.
 */
export function clientFounderFlagsAllowed(info: { debuggable?: unknown; installer?: unknown } | null | undefined): boolean {
  return !!info && info.debuggable === false && info.installer === PLAY_INSTALLER;
}

export function resolveEntitlement(sources: EntitlementSources, cutoffMs = TESTER_CUTOFF_MS): ProEntitlement {
  const verifiedPurchase = sources.verifiedPurchase === true;
  if (sources.platform !== 'android') return { pro: verifiedPurchase, foundingTester: false };
  const foundingTester = sources.clientFlagsAllowed === true &&
    (sources.persistedGrant || qualifiesByInstallDate(sources.firstInstallTimeMs, cutoffMs));
  return { pro: foundingTester || verifiedPurchase, foundingTester };
}

export function parseInstallTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resolve Pro for this launch. On a Play release build, a qualifying install time is stored
 * locally so a later launch still grants Pro if the bridge cannot be read. Debug, sideload,
 * and web never store or honor the flag.
 */
export async function loadProEntitlement(opts: {
  platform: EntitlementPlatform;
  readInstallTime?: () => Promise<unknown>;
  storage?: GrantStore;
  /** From clientFounderFlagsAllowed. Omitted or false ignores install time and pr.foundingTester. */
  clientFlagsAllowed?: boolean;
  verifiedPurchase?: boolean;
  cutoffMs?: number;
}): Promise<ProEntitlement> {
  const platform: EntitlementPlatform = opts.platform === 'android' ? 'android' : 'web';
  const clientFlagsAllowed = opts.clientFlagsAllowed === true;
  let persistedGrant = false;
  if (platform === 'android' && clientFlagsAllowed && opts.storage) {
    try { persistedGrant = opts.storage.getItem(FOUNDING_TESTER_KEY) === '1'; } catch { persistedGrant = false; }
  }
  let firstInstallTimeMs: number | null = null;
  if (platform === 'android' && opts.readInstallTime) {
    try { firstInstallTimeMs = parseInstallTime(await opts.readInstallTime()); }
    catch { firstInstallTimeMs = null; }
  }
  const entitlement = resolveEntitlement({
    platform,
    firstInstallTimeMs,
    persistedGrant,
    clientFlagsAllowed,
    verifiedPurchase: opts.verifiedPurchase === true,
  }, opts.cutoffMs);
  if (entitlement.foundingTester && opts.storage?.getItem(FOUNDING_TESTER_KEY) !== '1') {
    try { opts.storage?.setItem(FOUNDING_TESTER_KEY, '1'); } catch { /* storage may be blocked */ }
  }
  return entitlement;
}

/** Read PackageInfo.firstInstallTime from the PatrolScan plugin. Returns null when the method is absent. */
export async function readNativeFirstInstallTime(plugin: { firstInstallTime?: () => Promise<{ firstInstallTime?: unknown } | null | undefined> } | undefined): Promise<unknown> {
  if (!plugin?.firstInstallTime) return null;
  const result = await plugin.firstInstallTime();
  return result?.firstInstallTime ?? null;
}

/**
 * Stop History map shading is included with Pro. A saved `pr.stopheat` value of
 * `1` does not draw the layer unless verified Pro is active. The web build never
 * passes pro here. School-zone and work-zone alerts are a separate, free check.
 */
export function stopHistoryShadingOn(pro: boolean, saved: string | null): boolean {
  return pro && saved === '1';
}

/** School-zone and work-zone upcoming-camera alerts stay free for everyone. */
export const FREE_TRAFFIC_CAMERA_ALERT_TYPES = ['school_zone', 'work_zone'] as const;
export type FreeTrafficCameraAlertType = (typeof FREE_TRAFFIC_CAMERA_ALERT_TYPES)[number];

export function isFreeTrafficCameraAlertType(type: string): type is FreeTrafficCameraAlertType {
  return (FREE_TRAFFIC_CAMERA_ALERT_TYPES as readonly string[]).includes(type);
}

/**
 * Traffic-camera map pins and paid camera alerts (speed, red-light, monitoring)
 * require Pro. Founding testers already have `pro: true`. The web app stays
 * locked for those features unless a future verified purchase is passed in.
 * School-zone and work-zone alerts are not gated. Flock cameras, police
 * detection, and BLE scanning are not gated here.
 */
export function trafficCamerasUnlocked(entitlement: Pick<ProEntitlement, 'pro'>): boolean {
  return entitlement.pro === true;
}

/** Upcoming-camera alerts: school-zone and work-zone are free; other types need Pro. */
export function trafficCameraAlertUnlocked(entitlement: Pick<ProEntitlement, 'pro'>, type: string): boolean {
  return isFreeTrafficCameraAlertType(type) || trafficCamerasUnlocked(entitlement);
}
