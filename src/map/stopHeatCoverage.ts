/** Where Stop History has records, and whether a location is inside that coverage. */
import { heatTilesFor } from './stopHeatLayer';

/** Plain-language list of covered areas. Keep in step with scripts/stop-heat-sources.mjs. */
export const STOP_HISTORY_AREAS: string[] = [
  'New York City',
  'Chicago, Springfield, Champaign and Urbana, IL',
  'Cincinnati, OH',
  'Montgomery County, MD',
  'San Francisco, CA (2007–2016)',
  'Montana and Vermont state police (2009–2017)',
];

interface CoverageIndex { tileDeg: number; tiles: Record<string, number>; beatBounds?: Record<string, [number, number, number, number]> }

/** Tiles with only a handful of stray records (geocoding noise) don't count as coverage. */
const MIN_TILE_RECORDS = 50;

/** True when the 0.25° tile holding the point has real coverage, or the point is inside a mapped beat area. */
export function hasStopHistoryNear(idx: CoverageIndex, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !idx?.tiles) return false;
  const d = idx.tileDeg || 0.25;
  const keys = heatTilesFor(idx, { south: lat, west: lng, north: lat, east: lng });
  if (keys.some(k => (idx.tiles[k] ?? 0) >= MIN_TILE_RECORDS)) return true;
  const m = Math.min(0.05, d / 5);
  for (const [w, s, e, n] of Object.values(idx.beatBounds ?? {})) {
    if (lng >= w - m && lng <= e + m && lat >= s - m && lat <= n + m) return true;
  }
  return false;
}

export function stopHistoryAreaNote(here: boolean | null): string {
  const list = STOP_HISTORY_AREAS.join(' · ');
  if (here === false) return `No stop history for your area. Records are only available for: ${list}.`;
  if (here === true) return `Stop history records cover your area. Coverage is limited to: ${list}.`;
  return `Stop history is only available for: ${list}.`;
}
