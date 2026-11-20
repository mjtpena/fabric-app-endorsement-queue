import { describe, expect, it } from 'vitest';

import { arcPath, hashString, rosette, sealInitials, sealSeed, waxOutline } from '../hall/geometry';
import type { ChecklistAnswer, EndorsementEvent, EndorsementRequest } from '../model';
import { buildHall, isDimmed, layoutHall, lensGroups, todayFor, validityFraction, type HallData } from './hall';

const NOW = new Date('2026-11-20T12:00:00Z');
const day = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

const people = [
  { sub: 'rev-a', isAdmin: true },
  { sub: 'rev-b', isAdmin: true },
  { sub: 'own-1', isAdmin: false },
  { sub: 'own-2', isAdmin: false },
];

let n = 0;
function req(p: Partial<EndorsementRequest>): EndorsementRequest {
  n++;
  return {
    id: `r${n}`,
    modelName: `Model ${n}`,
    workspace: 'Finance',
    modelUrl: null,
    ownerSub: 'own-1',
    ownerName: 'Owner One',
    requestedLevel: 'certified',
    justification: 'Because it is the trusted one.',
    status: 'submitted',
    reviewerSub: null,
    reviewerName: null,
    submittedAt: day(-3),
    decidedAt: null,
    expiresAt: null,
    lastResubmittedAt: null,
    checklistVersion: 2,
    renewalOfId: null,
    ...p,
  };
}

function ev(r: EndorsementRequest, type: EndorsementEvent['type'], bySub: string, at: string): EndorsementEvent {
  return { id: `${r.id}-${type}`, requestId: r.id, type, bySub, byName: bySub, note: null, at };
}

function approved(p: Partial<EndorsementRequest>, decided: number, expires: number | null) {
  const r = req({ status: 'approved', reviewerSub: 'rev-a', reviewerName: 'Rev A', decidedAt: day(decided), expiresAt: expires === null ? null : day(expires), ...p });
  if (expires === null) r.requestedLevel = 'promoted';
  const events = [ev(r, 'submitted', r.ownerSub, day(decided - 5)), ev(r, 'claimed', 'rev-a', day(decided - 2)), ev(r, 'approved', 'rev-a', r.decidedAt!)];
  return { r, events };
}

function fixture(): HallData {
  const a = approved({ modelName: 'Sales Performance', workspace: 'Sales' }, -355, 10);
  const b = approved({ modelName: 'Ledger', ownerSub: 'own-2', ownerName: 'Owner Two' }, -370, -5);
  const c = approved({ modelName: 'Headcount', reviewerSub: 'rev-b', reviewerName: 'Rev B' }, -30, null);
  c.events = c.events.map((e) => (e.type === 'submitted' ? e : { ...e, bySub: 'rev-b' }));
  const waiting = req({ modelName: 'Support Tickets', submittedAt: day(-12) });
  const assay = req({ modelName: 'Field Ops', status: 'in_review', reviewerSub: 'rev-a', reviewerName: 'Rev A' });
  const back = req({ modelName: 'Product Usage', status: 'changes_requested', reviewerSub: 'rev-b', reviewerName: 'Rev B' });
  const rejected = req({ modelName: 'Old', status: 'rejected', reviewerSub: 'rev-a' });
  const events = [
    ...a.events,
    ...b.events,
    ...c.events,
    ev(waiting, 'submitted', 'own-1', waiting.submittedAt),
    ev(assay, 'submitted', 'own-1', day(-3)),
    ev(assay, 'claimed', 'rev-a', day(-2)),
    ev(back, 'submitted', 'own-1', day(-3)),
    ev(back, 'claimed', 'rev-b', day(-2)),
    ev(back, 'changes_requested', 'rev-b', day(-1)),
  ];
  const answer = (r: EndorsementRequest, itemKey: string, result: 'pass' | 'fail', by: string): ChecklistAnswer => ({
    id: `${r.id}-${itemKey}`,
    requestId: r.id,
    itemKey,
    stage: 'review',
    result,
    evidence: null,
    answeredBySub: by,
    answeredByName: by,
    answeredAt: day(-1.5),
  });
  const answers = [answer(assay, 'owner', 'pass', 'rev-a'), answer(assay, 'refresh', 'pass', 'rev-a'), answer(back, 'tests', 'fail', 'rev-b'), answer(back, 'owner', 'pass', 'rev-b')];
  return buildHall([a.r, b.r, c.r, waiting, assay, back, rejected], events, people, answers, NOW);
}

describe('seal geometry', () => {
  it('derives stable initials and seeds', () => {
    expect(sealInitials('Sales Performance')).toBe('SP');
    expect(sealInitials('Customer 360')).toBe('C360');
    expect(sealInitials('Inventory Snapshot (copy)')).toBe('IS');
    expect(sealInitials('Finance')).toBe('Fi');
    expect(sealInitials('  ')).toBe('?');
    expect(sealSeed('Sales  Performance', 'Sales')).toBe(sealSeed('sales performance', ' sales '));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('draws a deterministic guilloché and closed paths', () => {
    const a = rosette(1234);
    const b = rosette(1234);
    expect(a).toBe(b);
    expect(a.band.length).toBeGreaterThanOrEqual(9);
    expect(a.lobes).toBeGreaterThanOrEqual(9);
    expect(a.band.every((d) => d.startsWith('M') && d.endsWith('Z'))).toBe(true);
    expect(rosette(1234, 'small').band.length).toBe(5);
    expect(waxOutline(7, 100)).toBe(waxOutline(7, 100));
  });

  it('draws arcs from 12 o’clock', () => {
    expect(arcPath(100, 0)).toBe('');
    expect(arcPath(100, 1)).toContain('A100 100 0 1 1 0 100');
    expect(arcPath(100, 0.25)).toBe('M0 -100A100 100 0 0 1 100 0');
  });
});

describe('the hall', () => {
  it('hangs approvals as seals and puts open requests on the bench', () => {
    const h = fixture();
    expect(h.seals.map((s) => s.request.modelName).sort()).toEqual(['Headcount', 'Ledger', 'Sales Performance']);
    expect(h.blanks.map((b) => b.request.modelName).sort()).toEqual(['Field Ops', 'Product Usage', 'Support Tickets']);
    expect(h.closed).toBe(1);
    const assay = h.blanks.find((b) => b.request.modelName === 'Field Ops')!;
    expect([assay.checked, assay.total]).toEqual([2, 10]);
    const back = h.blanks.find((b) => b.request.modelName === 'Product Usage')!;
    expect(back.failed).toBe(1);
  });

  it('drains the arc toward the expiry', () => {
    expect(validityFraction({ decidedAt: day(-100), expiresAt: day(100) }, NOW)).toBeCloseTo(0.5);
    expect(validityFraction({ decidedAt: day(-200), expiresAt: day(-5) }, NOW)).toBe(0);
    expect(validityFraction({ decidedAt: day(-5), expiresAt: null }, NOW)).toBeNull();
    const h = fixture();
    expect(h.seals.find((s) => s.request.modelName === 'Headcount')!.fraction).toBeNull();
  });

  it('groups by lens with stable colours', () => {
    const h = fixture();
    expect(lensGroups(h, 'level').map((g) => [g.key, g.rim])).toEqual([
      ['certified', 'gold'],
      ['promoted', 'slate'],
    ]);
    expect(lensGroups(h, 'expiry').map((g) => g.key)).toEqual(['expired', 'due', 'none', 'pending']);
    const reviewers = lensGroups(h, 'reviewer');
    expect(reviewers[reviewers.length - 1].key).toBe('~unclaimed');
    expect(new Set(lensGroups(h, 'owner').map((g) => g.rim)).size).toBe(2);
  });

  it('lays out every item once and keeps groups together', () => {
    const h = fixture();
    for (const cols of [2, 3, 6]) {
      const l = layoutHall(h, 'level', cols);
      expect(l.seals).toHaveLength(3);
      expect(l.blanks).toHaveLength(3);
      expect(new Set(l.seals.map((p) => `${p.x},${p.y}`)).size).toBe(3);
      expect(l.bounds.w).toBeGreaterThan(0);
      expect(l.blanks.every((b) => b.y > Math.max(...l.seals.map((s) => s.y)))).toBe(true);
    }
    const wide = layoutHall(h, 'level', 6);
    expect(wide.plaques.map((p) => p.label)).toEqual(['Certified', 'Promoted']);
    expect(new Set(wide.seals.map((s) => s.y)).size).toBe(1);
  });

  it('ranks Today by severity: expired and long waits, then due, then work in hand', () => {
    const h = fixture();
    const t = todayFor(h, 'reviewer', { sub: 'rev-a', isAdmin: true });
    expect(t.map((x) => x.title)).toEqual([
      'Ledger seal has expired',
      'Support Tickets waits for a reviewer',
      'Sales Performance seal is nearly drained',
      'Field Ops is on your desk',
    ]);
    expect(t[1].severity).toBe('bad');
    const mine = todayFor(h, 'owner', { sub: 'own-1', isAdmin: false });
    expect(mine[0].title).toBe('Sales Performance seal is nearly drained');
    expect(mine.some((x) => x.title === 'Product Usage came back with changes')).toBe(true);
    expect(mine.some((x) => x.title.startsWith('Ledger'))).toBe(false);
    expect(todayFor(h, 'all', { sub: 'rev-a', isAdmin: true }).length).toBeLessThanOrEqual(5);
  });

  it('dims what is not yours in the chosen view', () => {
    const h = fixture();
    const ledger = h.seals.find((s) => s.request.modelName === 'Ledger')!;
    expect(isDimmed(ledger, 'all', { sub: 'own-1', isAdmin: false })).toBe(false);
    expect(isDimmed(ledger, 'owner', { sub: 'own-1', isAdmin: false })).toBe(true);
    expect(isDimmed(ledger, 'reviewer', { sub: 'rev-a', isAdmin: true })).toBe(false);
    expect(isDimmed(ledger, 'reviewer', { sub: 'rev-b', isAdmin: true })).toBe(true);
    const waiting = h.blanks.find((b) => b.status === 'submitted')!;
    expect(isDimmed(waiting, 'reviewer', { sub: 'rev-b', isAdmin: true })).toBe(false);
    expect(isDimmed(waiting, 'reviewer', { sub: 'own-1', isAdmin: false })).toBe(false);
  });
});
