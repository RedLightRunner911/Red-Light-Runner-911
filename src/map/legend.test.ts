import { describe, it, expect } from 'vitest';
import { legendHtml, loadLegendState, legendCategories, LEGEND } from './legend';
describe('legend', () => {
  it('collapsed by default, all categories present', () => {
    const st = loadLegendState(undefined); expect(st.open).toBe(false);
    const h = legendHtml(st); expect(h).not.toContain('class="lg" open'); for (const c of LEGEND) expect(h).toContain(c.title);
    expect(h).toContain('Strong'); expect(h).toMatch(/lg-peek.*Flock camera.*You.*Gear hit/); expect(h).not.toContain('Crowd'); expect(h).not.toContain('Vehicles'); expect(h).not.toMatch(/data-cat="\w+" open/);
  });
  it('restores saved state', () => {
    const st = loadLegendState({ getItem: () => JSON.stringify({ open: true, cats: { wifi: true } }) });
    const h = legendHtml(st); expect(h).toContain('class="lg" open'); expect(h).toContain('data-cat="gear">'); expect(h).toContain('data-cat="wifi" open');
  });
  it('bad storage falls back', () => { expect(loadLegendState({ getItem: () => '{bad' }).open).toBe(false); });
  it('hides traffic cameras for non-Pro and keeps Flock in the peek row', () => {
    const cats = legendCategories({ trafficCameras: false });
    expect(cats.some(c => c.id === 'tcam')).toBe(false);
    const h = legendHtml(loadLegendState(undefined), cats);
    expect(h).not.toContain('Traffic cameras');
    expect(h).toContain('Flock camera');
    expect(legendCategories({ trafficCameras: true }).some(c => c.id === 'tcam')).toBe(true);
  });
});
