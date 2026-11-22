import type { LiveDevice } from '../map/liveDevices';
import type { Vehicle } from '../fusion/vehicles';

const RECENT_MS = 30_000;
type Device = Pick<LiveDevice, 'key' | 'kind' | 'label' | 'confidence' | 'lastSeen'>;
type Group = Pick<Vehicle, 'confidence' | 'lastSeen'> & { members: readonly { key: string }[] };
export interface LiveHitSummary { label: string; percent: number; more: number }

/** Glance-only summary of the same active, unverified matches shown in the swipe-up sheet. */
export function selectLiveHit(devices: readonly Device[], vehicles: readonly Group[], now = Date.now()): LiveHitSummary | null {
  const recent = (t: number) => t <= now && now - t <= RECENT_MS;
  const groups = vehicles.filter(v => recent(v.lastSeen) && Number.isFinite(v.confidence));
  const memberKeys = new Set(groups.flatMap(v => v.members.map(m => m.key)));
  const hits = [
    ...groups.map(v => ({ label: 'Possible patrol vehicle', confidence: v.confidence, lastSeen: v.lastSeen })),
    ...devices.filter(d => d.kind === 'match' && recent(d.lastSeen) && !memberKeys.has(d.key) && d.confidence !== undefined && Number.isFinite(d.confidence))
      .map(d => ({ label: d.label, confidence: d.confidence!, lastSeen: d.lastSeen })),
  ];
  if (!hits.length) return null;
  hits.sort((a, b) => b.confidence - a.confidence || b.lastSeen - a.lastSeen);
  return { label: hits[0].label, percent: Math.round(Math.max(0, Math.min(1, hits[0].confidence)) * 100), more: hits.length - 1 };
}
