/**
 * A mirror of the row-level security on the entities (rayfin/data/*.ts), so domain code and tests can check that
 * every write the app makes is one the deployed API will accept. Keep in step with the decorators.
 *
 * What the database enforces (Fabric mode):
 * - EndorsementRequest create: ownerSub = caller and status = 'submitted'; the fields below cannot be set.
 * - EndorsementRequest update: caller is the owner, or the claiming reviewer, or the row is still 'submitted';
 *   the fields below are frozen (so nobody, not even the owner, can change who owns it or what was asked).
 * - ChecklistAnswer / EndorsementEvent create: stamped with the caller's sub. No update or delete on either.
 * What it cannot express (no admin claim exists) is enforced in src/domain/workflow.ts: only admins claim and decide,
 * the reviewer is never the owner, and only the claiming reviewer decides.
 */
import type { EndorsementRequest } from '../model';

export const REQUEST_CREATE_EXCLUDED = ['reviewerSub', 'reviewerName', 'decidedAt', 'expiresAt', 'lastResubmittedAt'] as const;

/** Everything the owner wrote is frozen; only status, reviewer and decision fields can change. */
export const REQUEST_UPDATE_EXCLUDED = [
  'modelName',
  'workspace',
  'modelUrl',
  'ownerSub',
  'ownerName',
  'requestedLevel',
  'justification',
  'submittedAt',
  'checklistVersion',
  'renewalOfId',
] as const;

/** The update row policy: owner, claiming reviewer, or an unclaimed submitted request. */
export function canWriteRequestRow(sub: string, req: Pick<EndorsementRequest, 'ownerSub' | 'reviewerSub' | 'status'>): boolean {
  return req.ownerSub === sub || (req.reviewerSub !== null && req.reviewerSub === sub) || req.status === 'submitted';
}

/** The create row policy. */
export function canCreateRequestRow(sub: string, req: Pick<EndorsementRequest, 'ownerSub' | 'status'>): boolean {
  return req.ownerSub === sub && req.status === 'submitted';
}
