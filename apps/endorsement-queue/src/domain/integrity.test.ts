import type { DataStore } from '@x10/shared/data';
import { MINUTE } from '@x10/shared/lib';
import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas, PERSONA } from '../app.config';
import { neededItems } from '../config/checklist';
import { defs, type EndorsementEvent, type EndorsementRequest, type Schema } from '../model';
import { seed } from '../seed';
import { currentAnswers } from './approval';
import { checkIntegrity, eventProblem, trailStatus } from './integrity';
import { PolicyViolation, policyStore } from './policyStore.testutil';
import { listAdminSubs, listEvents, listRequests } from './requests';
import { loadRegister } from './register';
import { claimRequest, decideRequest, latestReviewerComment, saveReview } from './workflow';

const at = (m: number) => new Date(FIXED_NOW.getTime() + m * MINUTE);

async function setup() {
  const raw = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await raw.repo('Person').list();
  const p = (sub: string) => people.find((x) => x.sub === sub)!;
  const byName = async (name: string) => (await listRequests(raw)).find((r) => r.modelName === name)!;
  return { raw, alex: p(PERSONA.alex), jordan: p(PERSONA.jordan), sam: p(PERSONA.sam), priya: p(PERSONA.priya), byName };
}

/** What a malicious signed-in user could do through the API, as far as the row policies allow. */
const api = (raw: DataStore<Schema>, sub: string) => policyStore(raw, sub);

const ev = (over: Partial<EndorsementEvent>): EndorsementEvent => ({
  id: 'e',
  requestId: 'r1',
  type: 'submitted',
  bySub: 'owner',
  byName: 'Owner',
  note: null,
  at: at(0).toISOString(),
  ...over,
});
const req = (over: Partial<EndorsementRequest> = {}) =>
  ({ id: 'r1', ownerSub: 'owner', reviewerSub: null, status: 'submitted', ...over }) as EndorsementRequest;
const admins = new Set(['rev', 'rev2']);

describe('eventProblem and trailStatus (pure)', () => {
  it('accepts owner events by the owner and reviewer events by an eligible admin', () => {
    const r = req({ reviewerSub: 'rev', status: 'approved' });
    expect(eventProblem(ev({ type: 'submitted' }), r, admins)).toBeNull();
    expect(eventProblem(ev({ type: 'claimed', bySub: 'rev' }), r, admins)).toBeNull();
    expect(eventProblem(ev({ type: 'approved', bySub: 'rev' }), r, admins)).toBeNull();
    expect(eventProblem(ev({ type: 'renewal_due', bySub: 'rev2' }), r, admins)).toBeNull();
  });

  it('rejects events written by the wrong person', () => {
    const r = req({ reviewerSub: 'rev', status: 'in_review' });
    expect(eventProblem(ev({ type: 'withdrawn', bySub: 'stranger' }), r, admins)).toMatch(/owner/);
    expect(eventProblem(ev({ type: 'approved', bySub: 'stranger' }), r, admins)).toMatch(/not .* reviewer/i);
    expect(eventProblem(ev({ type: 'approved', bySub: 'rev2' }), r, admins)).toMatch(/claiming reviewer/);
    expect(eventProblem(ev({ type: 'claimed', bySub: 'owner' }), req({ ownerSub: 'owner' }), new Set(['owner']))).toMatch(/owner/);
    expect(eventProblem(ev({ type: 'renewal_due', bySub: 'stranger' }), r, admins)).toMatch(/reviewer/);
  });

  it('derives the status from valid events only', () => {
    const r = req({ reviewerSub: 'rev', status: 'in_review' });
    const events = [
      ev({ id: '1', type: 'submitted', at: at(1).toISOString() }),
      ev({ id: '2', type: 'claimed', bySub: 'rev', at: at(2).toISOString() }),
      ev({ id: '3', type: 'approved', bySub: 'stranger', at: at(3).toISOString() }),
    ];
    expect(trailStatus(r, events, admins)).toBe('in_review');
    const check = checkIntegrity(r, events, admins);
    expect(check.ignored).toEqual(new Set(['3']));
    expect(check.ok).toBe(false);
    expect(check.issues[0]).toMatch(/1 trail event was written by someone not allowed/);
  });

  it('flags a status that does not match the trail and an ineligible reviewer', () => {
    const events = [ev({ id: '1' })];
    expect(checkIntegrity(req({ status: 'withdrawn' }), events, admins).issues).toEqual([
      'The status says "Withdrawn" but the trail says "Submitted": the row was changed outside the app.',
    ]);
    expect(checkIntegrity(req({ status: 'submitted', reviewerSub: 'rev' }), events, admins).issues[0]).toMatch(/nobody has claimed/);
    const claimed = [...events, ev({ id: '2', type: 'claimed', bySub: 'rev', at: at(2).toISOString() })];
    expect(checkIntegrity(req({ status: 'in_review', reviewerSub: 'stranger' }), claimed, admins).issues).toContain(
      'The recorded reviewer is not an eligible reviewer.',
    );
    expect(checkIntegrity(req({ status: 'in_review', reviewerSub: 'rev' }), claimed, admins).ok).toBe(true);
  });

  it('every seeded request is consistent with its trail', async () => {
    const { raw } = await setup();
    const adminSubs = await listAdminSubs(raw);
    for (const r of await listRequests(raw)) {
      expect(checkIntegrity(r, await listEvents(raw, r.id), adminSubs).issues).toEqual([]);
    }
  });
});

describe('what a malicious signed-in user can and cannot do through the API', () => {
  it('cannot change the owner, model, link or justification of anyone’s request, not even an unclaimed one', async () => {
    const { raw, priya, byName } = await setup();
    const open = await byName('Support Tickets'); // Sam's, unclaimed
    for (const patch of [{ ownerSub: priya.sub }, { ownerName: 'Priya' }, { modelUrl: 'javascript:alert(1)' }, { justification: 'Changed' }]) {
      await expect(api(raw, priya.sub).repo('EndorsementRequest').update(open.id, patch)).rejects.toThrow(PolicyViolation);
    }
    // The owner cannot either: the link and justification are frozen after create.
    await expect(api(raw, open.ownerSub).repo('EndorsementRequest').update(open.id, { modelUrl: 'javascript:alert(1)' })).rejects.toThrow(PolicyViolation);
  });

  it('can still change the status of an unclaimed request: the app flags it and refuses to claim it', async () => {
    const { raw, priya, jordan, byName } = await setup();
    const open = await byName('Support Tickets');
    await api(raw, priya.sub).repo('EndorsementRequest').update(open.id, { status: 'withdrawn' });
    const events = await listEvents(raw, open.id);
    expect(checkIntegrity({ ...open, status: 'withdrawn' }, events, await listAdminSubs(raw)).ok).toBe(false);
    // Put it back to submitted but with a fake reviewer: a real reviewer is refused until the row is fixed.
    await raw.repo('EndorsementRequest').update(open.id, { status: 'in_review', reviewerSub: jordan.sub, reviewerName: 'Jordan Lee' });
    await expect(saveReview(raw, jordan, open.id, [], at(1))).rejects.toThrow(/does not match its decision trail/);
    await expect(decideRequest(raw, jordan, open.id, 'approve', 'Looks fine', at(1))).rejects.toThrow(/does not match its decision trail/);
  });

  it('forged answers and events in the user’s own name are ignored', async () => {
    const { raw, priya, alex, byName } = await setup();
    const r = await byName('Field Service Operations'); // owner Priya, claimed by Alex
    // A stranger appends "review" answers and an approval event in their own name.
    const sam = (await raw.repo('Person').list()).find((p) => p.sub === PERSONA.sam)!;
    for (const item of neededItems('certified', 2)) {
      await api(raw, sam.sub).repo('ChecklistAnswer').create({
        requestId: r.id, itemKey: item.key, stage: 'review', result: 'pass', evidence: null,
        answeredBySub: sam.sub, answeredByName: sam.displayName, answeredAt: at(1).toISOString(),
      });
      await api(raw, sam.sub).repo('ChecklistAnswer').create({
        requestId: r.id, itemKey: item.key, stage: 'self', result: 'fail', evidence: null,
        answeredBySub: sam.sub, answeredByName: sam.displayName, answeredAt: at(1).toISOString(),
      });
    }
    await api(raw, sam.sub).repo('EndorsementEvent').create({
      requestId: r.id, type: 'approved', bySub: sam.sub, byName: sam.displayName, note: 'Approved!', at: at(2).toISOString(),
    });
    const answers = await raw.repo('ChecklistAnswer').list({ where: { requestId: r.id } });
    expect(Object.keys(currentAnswers(r, answers, 'review'))).toHaveLength(4); // only Alex's four
    expect(currentAnswers(r, answers, 'self').owner.result).toBe('pass'); // Priya's, not Sam's
    const events = await listEvents(raw, r.id);
    const adminSubs = await listAdminSubs(raw);
    expect(latestReviewerComment(r, events, adminSubs)?.note).toBe('Reviewing this week.');
    const check = checkIntegrity(r, events, adminSubs);
    expect(check.ignored.size).toBe(1);
    // Forging stamps with someone else's sub is refused outright.
    await expect(
      api(raw, sam.sub).repo('EndorsementEvent').create({ requestId: r.id, type: 'approved', bySub: alex.sub, byName: 'Alex', note: null, at: at(3).toISOString() }),
    ).rejects.toThrow(PolicyViolation);
    void priya;
  });

  it('a request approved outside the app shows as a trail mismatch in the register', async () => {
    const { raw, sam, byName } = await setup();
    const own = await byName('Support Tickets'); // Sam owns it and may update his own row
    await api(raw, sam.sub).repo('EndorsementRequest').update(own.id, { status: 'approved', decidedAt: at(1).toISOString() });
    const entry = (await loadRegister(raw, FIXED_NOW)).find((e) => e.request.id === own.id)!;
    expect(entry.verification.ok).toBe(false);
  });

  it('claims still work normally on consistent rows', async () => {
    const { raw, jordan, byName } = await setup();
    const r = await byName('Support Tickets');
    await expect(claimRequest(api(raw, jordan.sub), jordan, r.id, at(1))).resolves.toMatchObject({ status: 'in_review' });
  });
});
