import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hasStopHistoryNear, stopHistoryAreaNote } from './stopHeatCoverage';

const idx = JSON.parse(readFileSync('public/data/stop-heat/index.json', 'utf8'));
describe('stop history coverage', () => {
  it('finds covered cities and rejects uncovered places', () => {
    expect(hasStopHistoryNear(idx, 40.7128, -74.006)).toBe(true);   // New York City
    expect(hasStopHistoryNear(idx, 41.8781, -87.6298)).toBe(true);  // Chicago
    expect(hasStopHistoryNear(idx, 40.0583, -74.4057)).toBe(false); // central New Jersey
    expect(hasStopHistoryNear(idx, 29.7604, -95.3698)).toBe(false); // Houston
  });
  it('explains coverage plainly', () => {
    expect(stopHistoryAreaNote(false)).toContain('No stop history for your area');
    expect(stopHistoryAreaNote(null)).toContain('New York City');
  });
});
