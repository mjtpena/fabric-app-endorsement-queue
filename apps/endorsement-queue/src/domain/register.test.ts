import type { Person } from '@x10/shared/identity';
import { DAY, parseCsv } from '@x10/shared/lib';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas, PERSONA } from '../app.config';
import { defs, type EndorsementEvent, type EndorsementRequest } from '../model';
import { seed } from '../seed';
import { addMonths } from './dates';
import { policyStore } from './policyStore.testutil';
import {
  ensureRenewalDueEvents,
  expiryLabel,
  expiryState,
  loadRegister,
  loadRenewals,
  registerCsv,
  renewalRows,
  searchRegister,
  verifyApproval,
} from './register';
import { getRequestBundle, listRequests } from './requests';

const plus = (days: number) => new Date(FIXED_NOW.getTime() + days * DAY).toISOString();

async function setup() {
  const raw = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await raw.repo('Person').list();
  const person = (sub: string) => people.find((p) => p.sub === sub)!;
  return { raw, people, alex: person(PERSONA.alex), jordan: person(PERSONA.jordan), sam: person(PERSONA.sam) };
}

describe('expiryState', () => {
  const r = { renewalDueDays: 30 };
  it('covers none, valid, due and expired', () => {
    expect(expiryState({ expiresAt: null }, FIXED_NOW, r)).toEqual({ kind: 'none', days: null });
    expect(expiryState({ expiresAt: plus(31) }, FIXED_NOW, r)).toEqual({ kind: 'valid', days: 31 });
    expect(expiryState({ expiresAt: plus(30) }, FIXED_NOW, r)).toEqual({ kind: 'due', days: 30 });
    expect(expiryState({ expiresAt: plus(10) }, FIXED_NOW, r)).toEqual({ kind: 'due', days: 10 });
    expect(expiryState({ expiresAt: plus(0) }, FIXED_NOW, r).kind).toBe('expired');
    expect(expiryState({ expiresAt: plus(-5) }, FIXED_NOW, r)).toEqual({ kind: 'expired', days: -5 });
  });

  it('labels the chip', () => {
    expect(expiryLabel({ kind: 'none', days: null }, null)).toBe('No expiry');
    expect(expiryLabel({ kind: 'due', days: 10 }, plus(10))).toBe('Renewal due · 10 d left');
    expect(expiryLabel({ kind: 'expired', days: -5 }, plus(-5))).toBe('Expired 5 d ago');
    expect(expiryLabel({ kind: 'valid', days: 200 }, plus(200))).toMatch(/^Valid to /);
  });
});

describe('register', () => {
  it('lists the six seeded approvals with the right expiry chips and a clean trail check', async () => {
    const { raw } = await setup();
    const entries = await loadRegister(raw, FIXED_NOW);
    expect(entries).toHaveLength(6);
    const kind = (name: string) => entries.find((e) => e.request.modelName === name)!.expiry;
    expect(kind('Sales Performance')).toEqual({ kind: 'due', days: 10 });
    expect(kind('Finance General Ledger')).toEqual({ kind: 'expired', days: -5 });
    expect(kind('Customer 360').kind).toBe('valid');
    expect(kind('HR Headcount').kind).toBe('none');
    expect(entries.every((e) => e.verification.ok)).toBe(true);
  });

  it('shows only the newest approval per model', async () => {
    const { raw } = await setup();
    const old = (await listRequests(raw)).find((r) => r.modelName === 'Sales Performance')!;
    await raw.repo('EndorsementRequest').create({ ...old, id: undefined, decidedAt: plus(-1), expiresAt: addMonths(plus(-1), 12) } as never);
    const entries = await loadRegister(raw, FIXED_NOW);
    const sales = entries.filter((e) => e.request.modelName === 'Sales Performance');
    expect(sales).toHaveLength(1);
    expect(sales[0].expiry.kind).toBe('valid');
  });

  it('searches and exports CSV', async () => {
    const { raw } = await setup();
    const entries = await loadRegister(raw, FIXED_NOW);
    expect(searchRegister(entries, 'finance').map((e) => e.request.modelName)).toEqual(['Finance General Ledger']);
    expect(searchRegister(entries, 'sam taylor').map((e) => e.request.modelName).sort()).toEqual(['Sales Performance', 'Supply Chain Inventory']);
    expect(searchRegister(entries, '  ')).toHaveLength(6);
    const rows = parseCsv(registerCsv(entries));
    expect(rows[0]).toEqual(['Model', 'Workspace', 'Level', 'Owner', 'Reviewer', 'Decided (UTC)', 'Expires (UTC)', 'Expiry status', 'Trail check', 'Model link']);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r[0] === 'Finance General Ledger')![7]).toBe('expired');
  });
});

describe('verifyApproval (register cross-check against the trail)', () => {
  const req = (over: Partial<EndorsementRequest> = {}): EndorsementRequest => ({
    id: 'r1',
    modelName: 'M',
    workspace: 'W',
    modelUrl: null,
    ownerSub: 'owner',
    ownerName: 'Owner',
    requestedLevel: 'certified',
    justification: 'Long enough.',
    status: 'approved',
    reviewerSub: 'rev',
    reviewerName: 'Rev',
    submittedAt: plus(-10),
    decidedAt: plus(-1),
    expiresAt: addMonths(plus(-1), 12),
    lastResubmittedAt: null,
    checklistVersion: 2,
    renewalOfId: null,
    ...over,
  });
  const ev = (over: Partial<EndorsementEvent> = {}): EndorsementEvent => ({
    id: 'e1',
    requestId: 'r1',
    type: 'approved',
    bySub: 'rev',
    byName: 'Rev',
    note: 'ok',
    at: plus(-1),
    ...over,
  });
  const admins = new Set(['rev']);

  it('passes a normal approval', () => {
    expect(verifyApproval(req(), [ev()], admins)).toEqual({ ok: true, reason: null });
  });
  it('flags an approval with no event, by the owner, by a non-admin, by another reviewer, or with a stretched expiry', () => {
    expect(verifyApproval(req(), [], admins).reason).toMatch(/No approval/);
    expect(verifyApproval(req({ ownerSub: 'rev' }), [ev()], admins).reason).toMatch(/own owner/);
    expect(verifyApproval(req({ reviewerSub: 'x' }), [ev({ bySub: 'x' })], admins).reason).toMatch(/not a reviewer/);
    expect(verifyApproval(req({ reviewerSub: 'other' }), [ev()], admins).reason).toMatch(/does not match/);
    expect(verifyApproval(req({ expiresAt: addMonths(plus(-1), 24) }), [ev()], admins).reason).toMatch(/later than/);
    expect(verifyApproval(req({ expiresAt: null }), [ev()], admins).reason).toMatch(/no expiry/);
    expect(verifyApproval(req({ requestedLevel: 'promoted', expiresAt: null }), [ev()], admins).ok).toBe(true);
  });
});

describe('renewals', () => {
  it('lists certified approvals due in the next 60 days and expired ones, soonest first', async () => {
    const { raw } = await setup();
    const rows = renewalRows(await listRequests(raw), FIXED_NOW);
    expect(rows.map((r) => [r.request.modelName, r.expiry.kind])).toEqual([
      ['Finance General Ledger', 'expired'],
      ['Sales Performance', 'due'],
      ['Customer 360', 'valid'],
    ]);
    expect(rows.every((r) => r.renewal === null)).toBe(true);
  });

  it('writes renewal_due once per request, only for admins, the first time Renewals is opened after the date', async () => {
    const { raw, alex, jordan, sam } = await setup();
    const countDue = async () => (await raw.repo('EndorsementEvent').list({ where: { type: 'renewal_due' } })).length;
    expect(await countDue()).toBe(0);

    // A model owner opening Renewals writes nothing.
    expect(await ensureRenewalDueEvents(policyStore(raw, sam.sub), sam, FIXED_NOW)).toBe(0);
    expect(await countDue()).toBe(0);

    // The first admin visit writes one event each for the due and the expired model.
    const first = await loadRenewals(policyStore(raw, alex.sub), alex, FIXED_NOW);
    expect(first.eventsWritten).toBe(2);
    expect(await countDue()).toBe(2);

    // Later visits, by the same or another admin, write nothing more.
    expect((await loadRenewals(policyStore(raw, jordan.sub), jordan as Person, new Date(FIXED_NOW.getTime() + DAY))).eventsWritten).toBe(0);
    expect(await ensureRenewalDueEvents(raw, alex, FIXED_NOW)).toBe(0);
    expect(await countDue()).toBe(2);

    // Customer 360 becomes due 15 days later (45 days to expiry minus the 30-day window): one more event, once.
    const later = new Date(FIXED_NOW.getTime() + 16 * DAY);
    expect(await ensureRenewalDueEvents(raw, alex, later)).toBe(1);
    expect(await ensureRenewalDueEvents(raw, alex, later)).toBe(0);

    const sales = (await listRequests(raw)).find((r) => r.modelName === 'Sales Performance')!;
    const trail = (await getRequestBundle(raw, sales.id)).events.map((e) => e.type);
    expect(trail).toEqual(['submitted', 'claimed', 'approved', 'renewal_due']);
  });

  it('a renewal_due event written by a non-admin does not suppress the real one', async () => {
    const { raw, alex, sam } = await setup();
    const sales = (await listRequests(raw)).find((r) => r.modelName === 'Sales Performance')!;
    // Any signed-in user can append an event in their own name through the API.
    await policyStore(raw, sam.sub).repo('EndorsementEvent').create({
      requestId: sales.id,
      type: 'renewal_due',
      bySub: sam.sub,
      byName: sam.displayName,
      note: 'Fake',
      at: FIXED_NOW.toISOString(),
    });
    expect(await ensureRenewalDueEvents(raw, alex, FIXED_NOW)).toBe(2);
    const due = await raw.repo('EndorsementEvent').list({ where: { requestId: sales.id, type: 'renewal_due' } });
    expect(due.map((e) => e.bySub).sort()).toEqual([alex.sub, sam.sub].sort());
    expect(await ensureRenewalDueEvents(raw, alex, FIXED_NOW)).toBe(0);
  });

  it('shows a renewal in progress once one is submitted', async () => {
    const { raw, sam } = await setup();
    const sales = (await listRequests(raw)).find((r) => r.modelName === 'Sales Performance')!;
    const { submitRequest } = await import('./workflow');
    const { neededItems } = await import('../config/checklist');
    const renewal = await submitRequest(
      raw,
      sam,
      { modelName: sales.modelName, workspace: sales.workspace, modelUrl: '', requestedLevel: 'certified', justification: 'Renewal for another year.' },
      neededItems('certified', 2).map((i) => ({ itemKey: i.key, result: 'pass', evidence: '' })),
      { renewalOfId: sales.id, now: FIXED_NOW },
    );
    const rows = renewalRows(await listRequests(raw), FIXED_NOW);
    expect(rows.find((r) => r.request.id === sales.id)!.renewal?.id).toBe(renewal.id);
  });
});
