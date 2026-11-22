import { describe, expect, it } from 'vitest';
import { selectLiveHit } from './liveHit';

const NOW = 100_000;
const hit = (key: string, confidence: number, lastSeen = NOW, label = 'Body camera') =>
  ({ key, kind: 'match' as const, label, confidence, lastSeen });

describe('compact live-hit summary', () => {
  it('hides idle, unmatched and expired activity', () => {
    expect(selectLiveHit([], [], NOW)).toBeNull();
    expect(selectLiveHit([{ ...hit('other', 0.8), kind: 'unmatched' }], [], NOW)).toBeNull();
    expect(selectLiveHit([hit('old', 0.95, NOW - 30_001)], [], NOW)).toBeNull();
    expect(selectLiveHit([hit('fresh', 0.6, NOW - 30_000)], [], NOW)?.percent).toBe(60);
  });
  it('shows the strongest match, including its original percentage, and counts additional hits', () => {
    expect(selectLiveHit([hit('a', 0.72), hit('b', 0.91, NOW - 800, 'Motorola radio')], [], NOW))
      .toEqual({ label: 'Motorola radio', percent: 91, more: 1 });
  });
  it('shows grouped vehicles once, not once per member', () => {
    const group = { confidence: 0.93, lastSeen: NOW, members: [{ key: 'a' }, { key: 'b' }] };
    expect(selectLiveHit([hit('a', 0.82), hit('b', 0.88), hit('c', 0.6)], [group], NOW))
      .toEqual({ label: 'Possible patrol vehicle', percent: 93, more: 1 });
  });
  it('does not let an expired vehicle suppress an active device', () => {
    const group = { confidence: 0.95, lastSeen: NOW - 31_000, members: [{ key: 'a' }, { key: 'b' }] };
    expect(selectLiveHit([hit('a', 0.77)], [group], NOW))
      .toEqual({ label: 'Body camera', percent: 77, more: 0 });
  });
});
