import { date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * The decision trail. Append-only: every status transition writes one row.
 *
 * Security: everyone reads; you can only create events stamped with your own sub (no forging events in someone
 * else's name); no update, no delete. The register cross-checks approvals against this trail.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.bySub),
})
export class EndorsementEvent {
  @uuid() id!: string;
  @uuid() requestId!: string;
  @set(
    'submitted',
    'claimed',
    'changes_requested',
    'resubmitted',
    'approved',
    'rejected',
    'withdrawn',
    'renewal_due',
  )
  type!:
    | 'submitted'
    | 'claimed'
    | 'changes_requested'
    | 'resubmitted'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'renewal_due';
  @text({ min: 1, max: 255 }) bySub!: string;
  @text({ min: 1, max: 100 }) byName!: string;
  @text({ max: 500, optional: true }) note?: string;
  @date() at!: Date;
}
