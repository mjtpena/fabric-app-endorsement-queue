import { date, entity, int, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * A request to have a semantic model promoted or certified, and its review state.
 *
 * Security (see README "Security model"):
 * - read: every signed-in user (the register is public inside the tenant).
 * - create: only as yourself (ownerSub = your sub) and only in status "submitted". Reviewer and decision fields
 *   cannot be set on create.
 * - update: the owner (withdraw, resubmit), the claiming reviewer (decide), or anyone while the request is still
 *   unclaimed in "submitted" (so a reviewer can claim it). Everything the owner wrote (model, workspace, link,
 *   owner, level, justification, checklist version) is frozen after create; only the workflow fields
 *   (status, reviewer, decision dates) can change. That reviewers are admins is enforced in the domain code, because
 *   there is no admin claim; the domain also flags rows whose status does not match the trail.
 * - delete: nobody (withdraw instead; the register and trail must stay complete).
 * Keep the excluded field lists in step with src/domain/policies.ts.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub).and(item.status.eq('submitted')),
  exclude: ['reviewerSub', 'reviewerName', 'decidedAt', 'expiresAt', 'lastResubmittedAt'],
})
@role('authenticated', 'update', {
  policy: (claims, item) =>
    claims.sub.eq(item.ownerSub).or(claims.sub.eq(item.reviewerSub)).or(item.status.eq('submitted')),
  exclude: [
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
  ],
})
export class EndorsementRequest {
  @uuid() id!: string;
  @text({ min: 3, max: 120 }) modelName!: string;
  @text({ min: 1, max: 100 }) workspace!: string;
  @text({ max: 500, optional: true }) modelUrl?: string;
  @text({ min: 1, max: 255 }) ownerSub!: string;
  @text({ min: 1, max: 100 }) ownerName!: string;
  @set('promoted', 'certified') requestedLevel!: 'promoted' | 'certified';
  @text({ min: 10, max: 1000 }) justification!: string;
  @set('submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'withdrawn')
  status!: 'submitted' | 'in_review' | 'changes_requested' | 'approved' | 'rejected' | 'withdrawn';
  @text({ max: 255, optional: true }) reviewerSub?: string;
  @text({ max: 100, optional: true }) reviewerName?: string;
  @date() submittedAt!: Date;
  @date({ optional: true }) decidedAt?: Date;
  @date({ optional: true }) expiresAt?: Date;
  @date({ optional: true }) lastResubmittedAt?: Date;
  @int() checklistVersion!: number;
  @uuid({ optional: true }) renewalOfId?: string;
}
