import { describe, expect, it } from 'vitest';
import {
  CONFLICTING_OWNERSHIP, decideOwnership, FOUNDER_CUTOFF_MS, founderAutoClaimEnabled, isOwnershipRaceError, LINKED_ELSEWHERE, plausibleFounderInstall,
} from '../../supabase/functions/_shared/ownership';
import { TESTER_CUTOFF_MS } from './pro';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const H = 'a'.repeat(64), OTHER = 'b'.repeat(64);

describe('purchase ownership', () => {
  it('first verified caller owns a new token; RTDN before any device is skipped', () => {
    expect(decideOwnership({ previousOwner: null, linkedOwner: null, presentedBy: A })).toEqual({ kind: 'owner', owner: A });
    expect(decideOwnership({ previousOwner: null, linkedOwner: null })).toEqual({ kind: 'skip' });
    expect(decideOwnership({ previousOwner: A, linkedOwner: null })).toEqual({ kind: 'owner', owner: A });
  });
  it('refuses a replayed token from another account without Google-proven account match', () => {
    expect(() => decideOwnership({ previousOwner: A, linkedOwner: null, presentedBy: B })).toThrow(LINKED_ELSEWHERE);
    expect(() => decideOwnership({ previousOwner: A, linkedOwner: null, presentedBy: B, presentedAccountHash: H, googleAccountHash: OTHER })).toThrow(LINKED_ELSEWHERE);
    expect(() => decideOwnership({ previousOwner: A, linkedOwner: null, presentedBy: B, presentedAccountHash: H, googleAccountHash: null })).toThrow(LINKED_ELSEWHERE);
    expect(() => decideOwnership({ previousOwner: A, linkedOwner: null, presentedBy: B, presentedAccountHash: 'short', googleAccountHash: 'short' })).toThrow(LINKED_ELSEWHERE);
  });
  it('relinks after reinstall when Google reports the same obfuscated account id', () => {
    expect(decideOwnership({ previousOwner: A, linkedOwner: null, presentedBy: B, presentedAccountHash: H, googleAccountHash: H }))
      .toEqual({ kind: 'relink', from: A, to: B });
  });
  it('a plan-change replacement token stays with the linked subscriber', () => {
    expect(decideOwnership({ previousOwner: null, linkedOwner: A, presentedBy: A })).toEqual({ kind: 'owner', owner: A });
    expect(() => decideOwnership({ previousOwner: null, linkedOwner: A, presentedBy: B, presentedAccountHash: H, googleAccountHash: H })).toThrow(LINKED_ELSEWHERE);
    expect(() => decideOwnership({ previousOwner: B, linkedOwner: A })).toThrow(CONFLICTING_OWNERSHIP);
  });
  it('recognises the trigger error from a lost concurrent claim', () => {
    expect(isOwnershipRaceError('Play purchase ownership cannot be reassigned')).toBe(true);
    expect(isOwnershipRaceError('duplicate key')).toBe(false);
  });
});

describe('founder auto-claim window', () => {
  it('matches the app cutoff exactly and rejects bogus times', () => {
    expect(FOUNDER_CUTOFF_MS).toBe(TESTER_CUTOFF_MS);
    expect(plausibleFounderInstall(FOUNDER_CUTOFF_MS - 1)).toBe(true);
    expect(plausibleFounderInstall(FOUNDER_CUTOFF_MS)).toBe(false);
    expect(plausibleFounderInstall(0)).toBe(false);
    expect(plausibleFounderInstall('1700000000000')).toBe(false);
    expect(plausibleFounderInstall(Number.NaN)).toBe(false);
  });
  it('is off unless FOUNDER_AUTO_CLAIM is explicitly enabled', () => {
    expect(founderAutoClaimEnabled(undefined)).toBe(false);
    expect(founderAutoClaimEnabled(null)).toBe(false);
    expect(founderAutoClaimEnabled('')).toBe(false);
    expect(founderAutoClaimEnabled('off')).toBe(false);
    expect(founderAutoClaimEnabled('false')).toBe(false);
    expect(founderAutoClaimEnabled('0')).toBe(false);
    expect(founderAutoClaimEnabled('ON')).toBe(true);
    expect(founderAutoClaimEnabled('true')).toBe(true);
    expect(founderAutoClaimEnabled('1')).toBe(true);
    expect(founderAutoClaimEnabled(' yes ')).toBe(true);
  });
});
