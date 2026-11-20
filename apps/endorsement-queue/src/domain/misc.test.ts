import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { neededItems } from '../config/checklist';
import { defs, type EndorsementRequest } from '../model';
import { seed } from '../seed';
import { canApprove } from './approval';
import { addMonths, daysUntil } from './dates';
import { canCreateRequestRow, canWriteRequestRow } from './policies';
import { ageDays, ageTone, queueView } from './queue';
import { emptyInput, findOpenDuplicate, getRequestBundle, listRequests, modelKey, renewalInput, validateRequestInput } from './requests';

describe('dates', () => {
  it('adds calendar months in UTC and clamps the day', () => {
    expect(addMonths('2026-11-20T09:00:00.000Z', 12)).toBe('2027-11-20T09:00:00.000Z');
    expect(addMonths('2026-01-31T00:00:00.000Z', 1)).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths('2028-02-29T00:00:00.000Z', 12)).toBe('2029-02-28T00:00:00.000Z');
    expect(addMonths('2027-11-20T09:00:00.000Z', -12)).toBe('2026-11-20T09:00:00.000Z');
  });

  it('counts days until a date, rounding up', () => {
    expect(daysUntil('2026-11-30T08:59:00.000Z', FIXED_NOW)).toBe(10);
    expect(daysUntil('2026-11-15T09:00:00.000Z', FIXED_NOW)).toBe(-5);
    expect(daysUntil('2026-11-20T08:00:00.000Z', FIXED_NOW)).toBe(0);
  });
});

describe('request form', () => {
  it('validates with the entity limits', () => {
    const e = validateRequestInput(emptyInput());
    expect(Object.keys(e).sort()).toEqual(['justification', 'modelName', 'requestedLevel', 'workspace']);
    const ok = validateRequestInput({
      modelName: 'Sales',
      workspace: 'WS',
      modelUrl: '',
      requestedLevel: 'promoted',
      justification: 'Ten chars!',
    });
    expect(ok).toEqual({});
    expect(validateRequestInput({ ...emptyInput(), modelUrl: 'ftp://x' }).modelUrl).toMatch(/https/);
    expect(validateRequestInput({ ...emptyInput(), modelName: 'x'.repeat(121) }).modelName).toMatch(/120 characters/);
    expect(validateRequestInput({ ...emptyInput(), justification: 'x'.repeat(1001) }).justification).toMatch(/1000/);
  });

  it('finds open duplicates by normalised model and workspace', () => {
    const r = { id: '1', modelName: 'Sales  Model', workspace: 'Finance', status: 'in_review' } as EndorsementRequest;
    expect(modelKey(r)).toBe('sales model|finance');
    expect(findOpenDuplicate([r], { modelName: 'sales model', workspace: ' FINANCE ' })?.id).toBe('1');
    expect(findOpenDuplicate([{ ...r, status: 'approved' }], { modelName: 'sales model', workspace: 'finance' })).toBeNull();
  });

  it('prefills a renewal from the old request', () => {
    const old = {
      modelName: 'M',
      workspace: 'W',
      modelUrl: null,
      requestedLevel: 'certified',
      decidedAt: '2025-11-30T00:00:00.000Z',
      justification: 'Original reason.',
    } as EndorsementRequest;
    const v = renewalInput(old);
    expect(v).toMatchObject({ modelName: 'M', workspace: 'W', modelUrl: '', requestedLevel: 'certified' });
    expect(v.justification).toBe('Renewal of the certified endorsement approved on 2025-11-30. Original reason.');
  });
});

describe('queue', () => {
  it('ages and colours requests: amber from 5 days, red from 10', () => {
    expect(ageDays({ submittedAt: '2026-11-08T23:00:00.000Z' }, FIXED_NOW)).toBe(12);
    expect([0, 4, 5, 9, 10, 30].map((d) => ageTone(d, { ageAmberDays: 5, ageRedDays: 10 }))).toEqual([
      'neutral',
      'neutral',
      'warn',
      'warn',
      'bad',
      'bad',
    ]);
  });

  it('filters by level and status and sorts oldest first', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const all = await listRequests(store);
    const open = queueView(all, { level: 'all', status: 'open' });
    expect(open.map((r) => r.modelName)).toEqual([
      'Support Tickets',
      'Product Usage',
      'Revenue Forecast',
      'Partner Portal',
      'Web Analytics',
      'Field Service Operations',
      'Procurement Spend',
    ]);
    expect(queueView(all, { level: 'promoted', status: 'open' }).map((r) => r.modelName)).toEqual([
      'Support Tickets',
      'Revenue Forecast',
      'Partner Portal',
    ]);
    expect(queueView(all, { level: 'all', status: 'rejected' })).toHaveLength(1);
    expect(queueView(all, { level: 'all', status: 'all' })).toHaveLength(15);
    expect(queueView(all, { level: 'all', status: 'open', mineSub: 'demo-reviewer-alex' }).map((r) => r.modelName)).toEqual([
      'Partner Portal',
      'Field Service Operations',
    ]);
  });
});

describe('policy mirror', () => {
  it('matches the decorators', () => {
    const row = { ownerSub: 'o', reviewerSub: 'r', status: 'in_review' as const };
    expect(canWriteRequestRow('o', row)).toBe(true);
    expect(canWriteRequestRow('r', row)).toBe(true);
    expect(canWriteRequestRow('x', row)).toBe(false);
    expect(canWriteRequestRow('x', { ...row, reviewerSub: null, status: 'submitted' })).toBe(true);
    expect(canWriteRequestRow('x', { ...row, status: 'approved' })).toBe(false);
    expect(canCreateRequestRow('o', { ownerSub: 'o', status: 'submitted' })).toBe(true);
    expect(canCreateRequestRow('o', { ownerSub: 'o', status: 'approved' })).toBe(false);
    expect(canCreateRequestRow('x', { ownerSub: 'o', status: 'submitted' })).toBe(false);
  });
});

describe('seed', () => {
  it('covers every status and both levels with 15 requests, answers and a trail each', async () => {
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    const all = await listRequests(store);
    expect(all).toHaveLength(15);
    const count = (s: string) => all.filter((r) => r.status === s).length;
    expect([count('submitted'), count('in_review'), count('changes_requested'), count('approved'), count('rejected'), count('withdrawn')]).toEqual([3, 2, 2, 6, 1, 1]);
    expect(new Set(all.map((r) => r.requestedLevel))).toEqual(new Set(['promoted', 'certified']));
    expect(all.filter((r) => r.checklistVersion === 1).length).toBe(3);
    for (const r of all) {
      const b = await getRequestBundle(store, r.id);
      expect(b.events[0].type).toBe('submitted');
      const selfKeys = new Set(b.answers.filter((a) => a.stage === 'self').map((a) => a.itemKey));
      expect(selfKeys.size).toBe(neededItems(r.requestedLevel, r.checklistVersion).length);
      if (r.status === 'approved') {
        expect(canApprove(r, b.answers)).toBe(true);
        expect(b.events.at(-1)!.type).toBe('approved');
      }
    }
  });

  it('is idempotent', async () => {
    const { runSeed } = await import('@x10/shared/runtime');
    const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
    expect(await runSeed(store, personas, seed, FIXED_NOW)).toBe(false);
    expect(await listRequests(store)).toHaveLength(15);
  });
});
