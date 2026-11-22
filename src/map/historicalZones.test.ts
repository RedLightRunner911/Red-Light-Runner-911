import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activityZoneAt, ActivityZoneAlertGate, buildActivityZones, considerHistoricalZoneNotice, containsPoint, historicalZoneStatus, HISTORICAL_ZONE_PRO_NOTE, zoneAlertsSavedOn, type BeatFeature } from './historicalZones';

const square = (west: number, south: number, d = .01): BeatFeature['geometry'] => ({
  type: 'Polygon', coordinates: [[[west, south], [west + d, south], [west + d, south + d],
    [west, south + d], [west, south]]],
});
const beat = (id: string, count: number, i: number): BeatFeature => ({
  bbox: [i * .02, 0, i * .02 + .01, .01], geometry: square(i * .02, 0),
  properties: { id, label: id, place: 'Test city', b: [1960, count] }, // 2025, year base 1990
});

describe('historical stop activity zones', () => {
  it('ranks actual same-year stop densities within one city', () => {
    // Four comparable 2025 beats stay rankable (Champaign's current set). The floor is temporary.
    const zones = buildActivityZones([beat('a', 10, 0), beat('b', 20, 1), beat('c', 30, 2), beat('d', 40, 3)], 1990);
    expect(zones.map(z => z.level)).toEqual(['low', 'typical', 'high', 'very-high']);
    expect(zones[3]).toMatchObject({ count: 40, year: 2025, comparable: 4 });
    expect(activityZoneAt(zones, .005, .065)?.id).toBe('d');
    expect(activityZoneAt(zones, 8, 8)).toBeNull();
  });
  it('will not classify one citywide total or absent 2025 data as a hotspot', () => {
    expect(buildActivityZones([beat('citywide', 25000, 0)], 1990)[0].level).toBe('insufficient');
    const historical = beat('old', 400, 0);
    historical.properties.b = [1904, 400]; // another year
    expect(buildActivityZones([historical, beat('b', 1, 1), beat('c', 3, 2), beat('d', 5, 3)], 1990)[0].level).toBe('insufficient');
  });
  it('handles multipolygons and holes without classifying adjacent streets', () => {
    const geometry = { type: 'MultiPolygon', coordinates: [
      [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]],
      [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
    ] };
    expect(containsPoint(geometry, .5, .5)).toBe(true);
    expect(containsPoint(geometry, 2, 2)).toBe(false);
    expect(containsPoint(geometry, 5.5, 5.5)).toBe(true);
    expect(containsPoint(geometry, 7, 7)).toBe(false);
  });
  it('suppresses repeated alerts, non-high levels and rapid transitions', () => {
    const zones = buildActivityZones([beat('a', 10, 0), beat('b', 20, 1), beat('c', 30, 2), beat('d', 40, 3)], 1990);
    const gate = new ActivityZoneAlertGate();
    expect(gate.enter(zones[2], true, false, 100000)).toBe(false); // high not opted in
    expect(gate.enter(zones[3], true, false, 110000)).toBe(true);
    expect(gate.enter(zones[3], true, false, 111000)).toBe(false);
    expect(gate.enter(null, true, false, 120000)).toBe(false);
    expect(gate.enter(zones[3], true, false, 210000)).toBe(false); // same area cooldown
    expect(gate.enter(null, true, false, 220000)).toBe(false);
    expect(gate.enter(zones[3], true, false, 1410000)).toBe(true);
  });
  it('stays off unless the saved choice is exactly 1', () => {
    expect(zoneAlertsSavedOn(null)).toBe(false);
    expect(zoneAlertsSavedOn('0')).toBe(false);
    expect(zoneAlertsSavedOn('')).toBe(false);
    expect(zoneAlertsSavedOn('true')).toBe(false);
    expect(zoneAlertsSavedOn('1')).toBe(true);
  });
  it('never alerts or shows a per-area rank without verified Pro, and does with Pro', () => {
    const zones = buildActivityZones([beat('a', 10, 0), beat('b', 20, 1), beat('c', 30, 2), beat('d', 40, 3)], 1990);
    const gate = new ActivityZoneAlertGate();
    const hidden = { pro: false, savedOn: true, includeHigh: false, canShow: true, now: 100000 };
    expect(considerHistoricalZoneNotice(gate, zones[3], hidden)).toBe(false);
    expect(historicalZoneStatus(zones[3], false)).toBe(HISTORICAL_ZONE_PRO_NOTE);
    expect(historicalZoneStatus(zones[3], false)).not.toContain(String(zones[3].count));
    expect(historicalZoneStatus(zones[3], false)).not.toMatch(/Very High|recorded stops|ranked among/);
    expect(considerHistoricalZoneNotice(gate, zones[3], { ...hidden, pro: true })).toBe(true);
    expect(historicalZoneStatus(zones[3], true)).toContain('Very High');
    expect(historicalZoneStatus(zones[3], true)).toContain(String(zones[3].count));
  });
  it('does not consume the per-area or global cooldown when the banner cannot be shown', () => {
    const zones = buildActivityZones([beat('a', 10, 0), beat('b', 20, 1), beat('c', 30, 2), beat('d', 40, 3)], 1990);
    const gate = new ActivityZoneAlertGate();
    expect(gate.enter(zones[3], true, false, 100000, false)).toBe(false);
    expect(gate.enter(zones[3], true, false, 100000, true)).toBe(true);
    const global = new ActivityZoneAlertGate();
    expect(global.enter(zones[3], true, false, 100000, false)).toBe(false);
    expect(global.enter(zones[2], true, true, 110000, true)).toBe(true);
    const area = new ActivityZoneAlertGate();
    expect(area.enter(zones[3], true, false, 100000, false)).toBe(false);
    expect(area.enter(null, true, false, 110000, true)).toBe(false);
    expect(area.enter(zones[3], true, false, 120000, true)).toBe(true);
    const viaNotice = new ActivityZoneAlertGate();
    const blocked = { pro: true, savedOn: true, includeHigh: false, canShow: false, now: 100000 };
    expect(considerHistoricalZoneNotice(viaNotice, zones[3], blocked)).toBe(false);
    expect(considerHistoricalZoneNotice(viaNotice, zones[3], { ...blocked, canShow: true })).toBe(true);
  });
  it('checks banner visibility before the gate and keeps notices behind verified Pro', () => {
    const main = readFileSync(new URL('../v2/main.ts', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../../v2/index.html', import.meta.url), 'utf8');
    expect(main).toContain("zoneAlertsSavedOn(localStorage.getItem('pr.historyZones.alerts'))");
    expect(main).not.toContain("getItem('pr.historyZones.alerts') !== '0'");
    expect(main).toContain('pro: hasVerifiedPro');
    const visible = main.slice(main.indexOf('const zoneBannerCanShow'), main.indexOf('checkHistoricalZone = async'));
    expect(visible).toContain("$('settings').classList.contains('open')");
    expect(visible).toContain('navSearchScreen.hidden');
    expect(visible).toContain("$('tc-banner').hidden");
    const check = main.slice(main.indexOf('checkHistoricalZone = async'), main.indexOf('void (async () => {'));
    expect(check).toContain('const canShow = zoneBannerCanShow()');
    expect(check.indexOf('const canShow = zoneBannerCanShow()')).toBeLessThan(check.indexOf('considerHistoricalZoneNotice'));
    expect(check.indexOf('considerHistoricalZoneNotice')).toBeLessThan(check.indexOf('banner.hidden = false'));
    expect(check).not.toMatch(/gate\.enter\(/);
    expect(html).not.toMatch(/id="history-zone-alerts"[^>]*\bchecked\b/);
    // Free edition: no PRO badges anywhere.
    expect(html).not.toContain('class="pro-mark">PRO<');
    expect(html).toContain('aria-describedby="heat-pro-offer"');
    expect(html).toContain('historical activity zone notices');
    expect(html).toContain('Historical records, not live police detection');
    expect(html).toContain('School-zone and work-zone alerts stay free');
    expect(html).not.toContain('Optional shaded areas');
  });
});
