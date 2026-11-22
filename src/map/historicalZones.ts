import { countBuckets, type HeatFilter } from './stopHeatLayer';

/**
 * Beat-level 2025 historical STOP density, ranked only against comparable beats
 * from the same published jurisdiction. It does not predict current police presence.
 */
export type ActivityLevel = 'very-high' | 'high' | 'typical' | 'low' | 'insufficient';
export interface BeatFeature {
  bbox?: number[];
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
  properties: { id?: string; label?: string; place?: string; b?: number[]; n?: number };
}
export interface ActivityZone {
  id: string; label: string; place: string; count: number; year: number;
  rate: number; level: ActivityLevel; comparable: number;
  geometry: BeatFeature['geometry']; bbox?: number[];
}
const M_PER_LAT = 111_320;
const ALL_2025: HeatFilter = { year: 2025, tod: null, dow: null };
/**
 * Temporary floor. Champaign currently has 4 beats with 2025 records, so a
 * city of that size stays rankable. Revisit when more Champaign data is added.
 * A single citywide total (Urbana) stays insufficient.
 */
const MIN_COMPARABLE_BEATS = 4;
const LEVEL_NAMES: Record<ActivityLevel, string> = {
  'very-high': 'Very High', high: 'High', typical: 'Typical', low: 'Low', insufficient: 'Insufficient Data',
};
export function activityLevelLabel(level: ActivityLevel): string {
  return LEVEL_NAMES[level];
}
/** No saved choice, or any value other than '1', leaves notices off. */
export function zoneAlertsSavedOn(stored: string | null): boolean {
  return stored === '1';
}
export const HISTORICAL_ZONE_PRO_NOTE = 'Historical activity zone notices are included with Patrol Radar Pro.';

function ringArea(ring: number[][]): number {
  if (ring.length < 3) return 0;
  const midLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const x = M_PER_LAT * Math.cos(midLat * Math.PI / 180) / 1000, y = M_PER_LAT / 1000;
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    twice += (a[0] * x) * (b[1] * y) - (b[0] * x) * (a[1] * y);
  }
  return Math.abs(twice) / 2;
}
function geometryArea(g: BeatFeature['geometry']): number {
  const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? g.coordinates as number[][][][] : [];
  return polys.reduce((sum, rings) => sum + Math.max(0, (rings[0] ? ringArea(rings[0]) : 0) -
    rings.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0)), 0);
}
function ringContains(ring: number[][], lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > lat) !== (b[1] > lat) && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function containsPoint(g: BeatFeature['geometry'], lat: number, lng: number): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? g.coordinates as number[][][][] : [];
  return polys.some(rings => !!rings[0] && ringContains(rings[0], lat, lng) && !rings.slice(1).some(hole => ringContains(hole, lat, lng)));
}
/** Each file is a single city's districts/beats. Do not compare Chicago to Champaign raw totals. */
export function buildActivityZones(features: readonly BeatFeature[], yearBase: number, year = 2025): ActivityZone[] {
  const filter = year === 2025 ? ALL_2025 : { year, tod: null, dow: null };
  const records = features.map(f => {
    const count = countBuckets(f.properties.b ?? [], undefined, filter, yearBase).n;
    const area = geometryArea(f.geometry);
    return { f, count, rate: area > 0 ? count / area : 0 };
  });
  const comparable = records.filter(r => r.count > 0 && r.rate > 0);
  const sorted = comparable.map(r => r.rate).sort((a, b) => a - b);
  return records.map(({ f, count, rate }) => {
    const below = sorted.filter(r => r < rate).length;
    const equal = sorted.filter(r => r === rate).length;
    const percentile = sorted.length > 1 ? (below + (equal - 1) / 2) / (sorted.length - 1) : 0;
    const level: ActivityLevel = comparable.length < MIN_COMPARABLE_BEATS || count === 0 || rate === 0 ? 'insufficient'
      : percentile >= .9 ? 'very-high' : percentile >= 2 / 3 ? 'high' : percentile >= .3 ? 'typical' : 'low';
    return {
      id: f.properties.id ?? f.properties.label ?? 'unknown',
      label: f.properties.label ?? 'Mapped historical area',
      place: f.properties.place ?? '',
      count, year, rate, level, comparable: comparable.length,
      geometry: f.geometry, bbox: f.bbox,
    };
  });
}
/** No area is *low* just because it lacks records. Only mapped polygons may be ranked. */
export function activityZoneAt(zones: readonly ActivityZone[], lat: number, lng: number): ActivityZone | null {
  return zones.find(z => (!z.bbox || (z.bbox[0] <= lng && z.bbox[2] >= lng && z.bbox[1] <= lat && z.bbox[3] >= lat)) &&
    containsPoint(z.geometry, lat, lng)) ?? null;
}
export class ActivityZoneAlertGate {
  private activeId: string | null = null;
  private lastAlertAt = -Infinity;
  private lastByArea = new Map<string, number>();
  /**
   * An alert is only emitted when entering a new eligible area, not on every GPS update.
   * `canShow` is decided before any commit: if the banner cannot be shown, an alert that
   * would otherwise fire does not start the 90-second global or 20-minute per-area cooldown.
   */
  enter(zone: ActivityZone | null, enabled: boolean, includeHigh: boolean, now: number, canShow = true): boolean {
    const id = zone?.id ?? null;
    if (id === this.activeId) return false;
    const eligible = enabled && !!zone && (zone.level === 'very-high' || (includeHigh && zone.level === 'high'));
    const inCooldown = !!zone && (
      now - this.lastAlertAt < 90_000 || now - (this.lastByArea.get(zone.id) ?? -Infinity) < 20 * 60_000
    );
    if (eligible && !inCooldown && !canShow) return false;
    this.activeId = id;
    if (!eligible || inCooldown || !zone) return false;
    this.lastAlertAt = now;
    this.lastByArea.set(zone.id, now);
    return true;
  }
  resetPosition() { this.activeId = null; }
}
export interface ZoneNoticeOptions {
  /** Verified Pro from hasVerifiedPro / effectiveAccess. The web build never sets this. */
  pro: boolean;
  savedOn: boolean;
  includeHigh: boolean;
  /** False when Settings, search, or another covering notice means the banner cannot be shown. */
  canShow: boolean;
  now: number;
}
/**
 * Non-Pro never alerts and does not touch the gate, so a later verified-Pro
 * check can still notice the current area. A hidden banner is passed through
 * and does not consume cooldowns.
 */
export function considerHistoricalZoneNotice(gate: ActivityZoneAlertGate, zone: ActivityZone | null, opts: ZoneNoticeOptions): boolean {
  if (!opts.pro || !opts.savedOn) return false;
  return gate.enter(zone, true, opts.includeHigh, opts.now, opts.canShow);
}
/** Per-area rank and 2025 count are Pro-only. Non-Pro gets the offer note and no local figures. */
export function historicalZoneStatus(zone: ActivityZone | null, pro: boolean): string {
  if (!pro) return HISTORICAL_ZONE_PRO_NOTE;
  if (!zone) return 'No comparable 2025 beat-level records at this location. Not classified as Low.';
  if (zone.level === 'insufficient')
    return `${zone.place || zone.label}: area-level ranking unavailable (only citywide or too few comparable 2025 beats).`;
  return `${zone.label}: ${activityLevelLabel(zone.level)} · ${zone.count.toLocaleString()} recorded stops in 2025 · ranked among ${zone.comparable} local beats/districts.`;
}
