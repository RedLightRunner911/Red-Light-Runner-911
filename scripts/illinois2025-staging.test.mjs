import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {appendIllinois2025, appendSpringfield2025, appendChampaign2025} from './illinois-2025-coverage.mjs';
import {assertOutputClean} from './stop-heat-lib.mjs';
import {matchingAgencies} from '../src/map/illinoisAgencyDirectory';
import {countBuckets, OPEN_FILTER} from '../src/map/stopHeatLayer';

const read = (name) => readFileSync(new URL(`../docs/data/illinois-2025/${name}`, import.meta.url), 'utf8');
const audit = () => JSON.parse(read('audit.json'));
const csvRows = (name) => read(name).trim().split(/\r?\n/).slice(1).map(row => row.split(','));

describe('2025 Illinois traffic review data', () => {
  it('accounts for fourteen alternatives without doubling their seven source extracts', () => {
    const report = audit();
    expect(report.files).toHaveLength(7);
    expect(report.files.reduce((n, file) => n + file.source_rows, 0)).toBe(2063429);
    expect(report.files.every((f) => f.matching_export_equivalent_rows === f.source_rows)).toBe(true);
    expect(report.files.reduce((n, f) => n + f.txt_only_rows, 0)).toBe(30);
    expect(report.files.every((f) => f.invalid_or_out_of_year_dates === 0 && f.unknown_times === 0)).toBe(true);
  });

  it('reconciles coarse CPD summaries and preserves counting uncertainty', () => {
    const rows = csvRows('cpd-beat-month-review.csv');
    expect(rows).toHaveLength(3278);
    expect(rows.reduce((n, r) => n + Number(r[2]), 0)).toBe(224851);
    expect(rows.reduce((n, r) => n + Number(r[3]), 0)).toBe(183);
    expect(rows.reduce((n, r) => n + Number(r[4]), 0)).toBe(224668);
    expect(rows.every(r => /^\d{1,4}$/.test(r[0]) && /^2025-\d{2}$/.test(r[1]) && Number(r[2]) === Number(r[3]) + Number(r[4]))).toBe(true);
    expect(audit().unique_encounters_verified).toBe(false);
  });

  it('retains family ownership so revised local and statewide records cannot be summed', () => {
    const report = audit();
    expect(report.overlaps.cpd.matching_statewide_attribute_rows).toBe(0);
    expect(report.overlaps.lake_bluff.matching_statewide_attribute_rows).toBe(1100);
    expect(report.overlaps.lake_bluff.candidate_agency_total_source_rows).toEqual({'13478': 1104});
    expect(report.overlaps.lake_bluff.geographic_identity_verified).toBe(false);
    const totals = {};
    for (const row of csvRows('agency-month-source-counts.csv')) totals[row[0]] = (totals[row[0]] ?? 0) + Number(row[3]);
    expect(totals).toEqual({statewide: 1837061, cpd: 224851, lake_bluff: 1517});
  });

  const asset = name => JSON.parse(readFileSync(new URL('../public/data/' + name, import.meta.url)));
  it('offers agency search inside Stop history in the Android interface', () => {
    const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    const directory = readFileSync(new URL('../src/map/illinoisAgencyDirectory.ts', import.meta.url), 'utf8');
    expect(directory).toContain('9,934 rows appear on 8 Springfield police beats.');
    expect(directory).toContain('4,691 rows appear on 4 Champaign police districts');

    const drawer = html.split('<aside id="heat-settings"')[1].split('</aside>')[0];
    expect(drawer).toContain('id="illinois-agencies"');
    expect(html.match(/id="illinois-agencies"/g)).toHaveLength(1);
  });
  it('allocates each agency-year to one source and matches all official agency codes', () => {
    const directory = asset('illinois-2025/agencies.json');
    assertOutputClean(directory);
    const agencies = directory.agencies;
    expect(new Set(agencies.map(a => a.code)).size).toBe(775);
    expect(agencies).toHaveLength(775);
    const totals = new Map();
    for (const [family, code, , n] of csvRows('agency-month-source-counts.csv')) {
      if (family === 'statewide' && code === '13478') continue;
      const owner = family === 'cpd' ? '13194' : family === 'lake_bluff' ? '13478' : code;
      totals.set(owner, (totals.get(owner) ?? 0) + Number(n));
    }
    for (const a of agencies) {
      expect(Object.keys(a).sort()).toEqual(['code','incomplete','name','page','rows','summaryPage']);
      expect(a.rows).toBe(totals.get(a.code));
      expect(a.page >= 1427 && a.page <= 1463).toBe(true);
      expect(a.summaryPage >= 6 && a.summaryPage < 1427).toBe(true);
    }
    expect(agencies.reduce((n,a) => n + a.rows, 0)).toBe(directory.rows);
    expect(directory.rows).toBe(2062325);
    expect(agencies.filter(a => a.incomplete)).toHaveLength(23);
    expect(new Set(agencies.map(a => a.summaryPage)).size).toBe(775);
    expect(matchingAgencies(agencies, 'bluff  LAKE')).toEqual([{name:'LAKE BLUFF POLICE', code:'13478', rows:1517, page:1444, summaryPage:687, incomplete:false}]);
    expect(matchingAgencies(agencies, '13194')[0].rows).toBe(224851);
    expect(matchingAgencies(agencies, 'no matching agency')).toEqual([]);
  });

  it('maps only unambiguous in-city beats and reconciles year, weekday and four-hour filters', () => {
    const beats = asset('stop-heat/beats/cpd_2025.json').features;
    const totals = new Map();
    for (const [beat, , n] of csvRows('cpd-beat-month-review.csv')) totals.set(beat,(totals.get(beat) ?? 0) + Number(n));
    expect(totals.get('3100')).toBe(1884);
    totals.delete('3100');
    expect(beats).toHaveLength(274);
    for (const {geometry, bbox, properties: p} of beats) {
      const code = p.id.split(':')[1];
      expect(['Polygon','MultiPolygon']).toContain(geometry.type);
      expect(bbox).toHaveLength(4);
      expect(p.n).toBe(totals.get(code));
      totals.delete(code);
      expect(countBuckets(p.b, [], {...OPEN_FILTER, year:2024}).n).toBe(0);
      let filtered = 0;
      for (let tod=0; tod<6; tod++) for (let dow=0; dow<7; dow++)
        filtered += countBuckets(p.b, [], {year:2025,tod,dow}).n;
      expect(filtered).toBe(p.n);
    }
    expect(totals.size).toBe(0);
    const index = asset('stop-heat/index.json');
    const cpd = index.sources.find(s => s.id === 'cpd_2025');
    expect(cpd.audit).toMatchObject({seen:224851, accepted:222967, rejected:1884, candidate_repeated_rows:183});
    expect(cpd.license_url).toBe('https://www.chicago.gov/city/en/narr/foia/data_disclaimer.html');
    expect(cpd.disclaimer).toMatch(/www\.cityofchicago\.org/);
    expect(index.notMapped.map(s => s.id)).toEqual(expect.arrayContaining(['cpd_2025_outside', 'idot_2025_upload', 'lake_bluff_2025_upload', 'champaign_2025_unmatched', 'urbana_2025_upload', 'decatur_2025_upload']));
    expect(() => appendIllinois2025(index)).toThrow(/already included/);
  });

  it('reassigns source indices on rebuild and fails closed on an overlapping Illinois source', () => {
    const base = asset('stop-heat/index.json');
    const chicago = base.sources.find(s => s.id === 'opp_chicago');
    base.sources = [chicago];
    base.beatFiles = [];
    base.totals = {mapped:0, stops:0, unmapped:0, beats:0, cells:0};
    const coverage = structuredClone(base.coverage);
    const overlap = structuredClone(base);
    overlap.sources[0].audit.time_range[1] = '2025-01-01';
    expect(() => appendIllinois2025(overlap)).toThrow(/overlapping Illinois/);
    const fc = appendIllinois2025(base);
    expect(fc.features.every(f => f.properties.src[0] === 1)).toBe(true);
    expect(base.totals).toEqual({mapped:222967,stops:222967,unmapped:1884,beats:274,cells:0});
    expect(base.coverage).toEqual(coverage);
  });

  it('shades Springfield beats and Champaign districts from reviewed aggregates only', () => {
    const html = readFileSync(new URL('../v2/index.html', import.meta.url), 'utf8');
    expect(html).toContain('Listed, not shaded');
    expect(html).not.toContain('Not on this map');
    const index = asset('stop-heat/index.json');
    assertOutputClean(index);
    const why = index.notMapped.find(s => s.id === 'idot_2025_upload').why;
    expect(why).toMatch(/searchable|Search the 775 reporting agencies/i);
    expect(why).toMatch(/Springfield/);
    expect(why).toMatch(/Champaign/);
    expect(index.notMapped.find(s => s.id === 'champaign_2025_unmatched').why).toMatch(/10 of 4,701/);
    expect(index.notMapped.find(s => s.id === 'urbana_2025_upload').why).toMatch(/no free public beat-boundary file/);
    expect(index.notMapped.find(s => s.id === 'decatur_2025_upload').why).toMatch(/801–810/);
    const spdRows = csvRows('spd-beat-month-review.csv');
    const spdTotals = new Map();
    for (const [beat, , n] of spdRows) spdTotals.set(beat, (spdTotals.get(beat) ?? 0) + Number(n));
    expect([...spdTotals.values()].reduce((a, b) => a + b, 0)).toBe(9934);
    const spd = asset('stop-heat/beats/spd_2025.json').features;
    assertOutputClean(spd);
    expect(spd).toHaveLength(8);
    for (const {geometry, bbox, properties: p} of spd) {
      const code = p.id.split(':')[1];
      expect(['Polygon', 'MultiPolygon']).toContain(geometry.type);
      expect(bbox).toHaveLength(4);
      expect(p.n).toBe(spdTotals.get(code));
      spdTotals.delete(code);
      expect(countBuckets(p.b, [], {...OPEN_FILTER, year: 2024}).n).toBe(0);
      let filtered = 0;
      for (let tod = 0; tod < 6; tod++) for (let dow = 0; dow < 7; dow++)
        filtered += countBuckets(p.b, [], {year: 2025, tod, dow}).n;
      expect(filtered).toBe(p.n);
    }
    expect(spdTotals.size).toBe(0);
    const chRows = csvRows('champaign-district-month-review.csv');
    const chTotals = new Map();
    for (const [district, , n] of chRows) chTotals.set(district, (chTotals.get(district) ?? 0) + Number(n));
    expect([...chTotals.values()].reduce((a, b) => a + b, 0)).toBe(4691);
    const champaign = asset('stop-heat/beats/champaign_2025.json').features;
    assertOutputClean(champaign);
    expect(champaign.map(f => f.properties.id)).toEqual([
      'champaign_2025:North', 'champaign_2025:Northwest', 'champaign_2025:South', 'champaign_2025:Southwest'
    ]);
    for (const {geometry, bbox, properties: p} of champaign) {
      const name = p.id.split(':')[1];
      expect(['Polygon', 'MultiPolygon']).toContain(geometry.type);
      expect(bbox).toHaveLength(4);
      expect(p.n).toBe(chTotals.get(name));
      chTotals.delete(name);
      expect(countBuckets(p.b, [], {...OPEN_FILTER, year: 2024}).n).toBe(0);
      let filtered = 0;
      for (let tod = 0; tod < 6; tod++) for (let dow = 0; dow < 7; dow++)
        filtered += countBuckets(p.b, [], {year: 2025, tod, dow}).n;
      expect(filtered).toBe(p.n);
    }
    expect(chTotals.size).toBe(0);
    const unmatched = csvRows('champaign-unmatched-location-codes.csv');
    expect(unmatched.reduce((n, r) => n + Number(r[1]), 0)).toBe(10);
    expect(unmatched.map(r => r[0].toUpperCase()).some(code => ['CHN', 'CHS', 'CHNW', 'CHSW'].includes(code))).toBe(false);
    const spdSource = index.sources.find(s => s.id === 'spd_2025');
    const chSource = index.sources.find(s => s.id === 'champaign_2025');
    expect(spdSource).toMatchObject({mapped: 9934, unmapped: 0});
    expect(chSource).toMatchObject({mapped: 4691, unmapped: 10});
    expect(index.totals).toMatchObject({mapped: 8003706, stops: 8003706, unmapped: 1513236, beats: 287, cells: 183115});
    expect(() => appendSpringfield2025(index)).toThrow(/already included/);
    expect(() => appendChampaign2025(index)).toThrow(/already included/);
  });

  it('reindexes Springfield and Champaign source indices on a clean rebuild', () => {
    const base = asset('stop-heat/index.json');
    const chicago = base.sources.find(s => s.id === 'opp_chicago');
    base.sources = [chicago];
    base.beatFiles = [];
    base.totals = {mapped: 0, stops: 0, unmapped: 0, beats: 0, cells: 0};
    appendIllinois2025(base);
    const spd = appendSpringfield2025(base);
    const champaign = appendChampaign2025(base);
    expect(spd.features.every(f => f.properties.src[0] === 2)).toBe(true);
    expect(champaign.features.every(f => f.properties.src[0] === 3)).toBe(true);
    expect(base.totals).toEqual({mapped: 222967 + 9934 + 4691, stops: 222967 + 9934 + 4691, unmapped: 1884 + 10, beats: 274 + 8 + 4, cells: 0});
    expect(base.notMapped.some(s => s.id === 'urbana_2025_upload')).toBe(true);
  });
});
