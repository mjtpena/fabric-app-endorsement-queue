/** Display words for statuses, levels, results and events (no React, so tests and the seed tool can use them). */
import type { Tone } from '@x10/shared/ui';

import type { EventType, Level, Result, Status } from './model';

export const STATUS_LABEL: Record<Status, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<Status, Tone> = {
  submitted: 'info',
  in_review: 'brand',
  changes_requested: 'warn',
  approved: 'ok',
  rejected: 'bad',
  withdrawn: 'neutral',
};

export const LEVEL_LABEL: Record<Level, string> = { promoted: 'Promoted', certified: 'Certified' };

export const RESULT_LABEL: Record<Result, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' };
export const RESULT_TONE: Record<Result, Tone> = { pass: 'ok', fail: 'bad', na: 'neutral' };

export const EVENT_LABEL: Record<EventType, string> = {
  submitted: 'Submitted',
  claimed: 'Claimed for review',
  changes_requested: 'Changes requested',
  resubmitted: 'Resubmitted',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  renewal_due: 'Renewal due',
};

export const EVENT_TONE: Record<EventType, Tone> = {
  submitted: 'info',
  claimed: 'brand',
  changes_requested: 'warn',
  resubmitted: 'info',
  approved: 'ok',
  rejected: 'bad',
  withdrawn: 'neutral',
  renewal_due: 'warn',
};
