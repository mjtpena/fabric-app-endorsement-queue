import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One answer to one checklist item. Append-only: a changed answer is a new row, and the latest row per
 * (request, stage, item) is the current one. "self" rows are the owner's self-assessment, "review" rows the
 * reviewer's verdict. Only rows written by the request's owner (self) or claiming reviewer (review) count.
 *
 * Security: everyone reads; you can only create rows stamped with your own sub; no update, no delete.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.answeredBySub),
})
export class ChecklistAnswer {
  @uuid() id!: string;
  @uuid() requestId!: string;
  @text({ min: 1, max: 40 }) itemKey!: string;
  @set('self', 'review') stage!: 'self' | 'review';
  @set('pass', 'fail', 'na') result!: 'pass' | 'fail' | 'na';
  @text({ max: 300, optional: true }) evidence?: string;
  @text({ min: 1, max: 255 }) answeredBySub!: string;
  @text({ min: 1, max: 100 }) answeredByName!: string;
  @date() answeredAt!: Date;
}
