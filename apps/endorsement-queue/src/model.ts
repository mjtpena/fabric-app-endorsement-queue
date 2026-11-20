/**
 * App data types and runtime entity definitions. Keep these in step with rayfin/data/*.ts:
 * every field listed here must exist on the entity class with the matching decorator.
 * Dates are ISO strings in the app; optional fields are `| null`.
 */
import type { EntityDefs } from '@x10/shared/data';
import { AppMarkerDef, PersonDef, type AppMarker, type Person } from '@x10/shared/identity';

/** The same numbers as the @text decorators on the entities. */
export const limits = {
  modelName: { min: 3, max: 120 },
  workspace: { min: 1, max: 100 },
  modelUrl: { max: 500 },
  justification: { min: 10, max: 1000 },
  evidence: { max: 300 },
  note: { max: 500 },
  /** Decision notes are required: at least a few characters. */
  decisionNote: { min: 3, max: 500 },
} as const;

export const LEVELS = ['promoted', 'certified'] as const;
export type Level = (typeof LEVELS)[number];

export const STATUSES = ['submitted', 'in_review', 'changes_requested', 'approved', 'rejected', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];

export const RESULTS = ['pass', 'fail', 'na'] as const;
export type Result = (typeof RESULTS)[number];

export const STAGES = ['self', 'review'] as const;
export type Stage = (typeof STAGES)[number];

export const EVENT_TYPES = [
  'submitted',
  'claimed',
  'changes_requested',
  'resubmitted',
  'approved',
  'rejected',
  'withdrawn',
  'renewal_due',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EndorsementRequest {
  id: string;
  modelName: string;
  workspace: string;
  modelUrl: string | null;
  ownerSub: string;
  ownerName: string;
  requestedLevel: Level;
  justification: string;
  status: Status;
  reviewerSub: string | null;
  reviewerName: string | null;
  submittedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  lastResubmittedAt: string | null;
  checklistVersion: number;
  renewalOfId: string | null;
}

export interface ChecklistAnswer {
  id: string;
  requestId: string;
  itemKey: string;
  stage: Stage;
  result: Result;
  evidence: string | null;
  answeredBySub: string;
  answeredByName: string;
  answeredAt: string;
}

export interface EndorsementEvent {
  id: string;
  requestId: string;
  type: EventType;
  bySub: string;
  byName: string;
  note: string | null;
  at: string;
}

export type Schema = {
  Person: Person;
  AppMarker: AppMarker;
  EndorsementRequest: EndorsementRequest;
  ChecklistAnswer: ChecklistAnswer;
  EndorsementEvent: EndorsementEvent;
};

export const defs: EntityDefs<Schema> = {
  Person: PersonDef,
  AppMarker: AppMarkerDef,
  EndorsementRequest: {
    name: 'EndorsementRequest',
    fields: {
      id: 'uuid',
      modelName: 'text',
      workspace: 'text',
      modelUrl: 'text',
      ownerSub: 'text',
      ownerName: 'text',
      requestedLevel: 'set',
      justification: 'text',
      status: 'set',
      reviewerSub: 'text',
      reviewerName: 'text',
      submittedAt: 'date',
      decidedAt: 'date',
      expiresAt: 'date',
      lastResubmittedAt: 'date',
      checklistVersion: 'int',
      renewalOfId: 'uuid',
    },
  },
  ChecklistAnswer: {
    name: 'ChecklistAnswer',
    fields: {
      id: 'uuid',
      requestId: 'uuid',
      itemKey: 'text',
      stage: 'set',
      result: 'set',
      evidence: 'text',
      answeredBySub: 'text',
      answeredByName: 'text',
      answeredAt: 'date',
    },
  },
  EndorsementEvent: {
    name: 'EndorsementEvent',
    fields: { id: 'uuid', requestId: 'uuid', type: 'set', bySub: 'text', byName: 'text', note: 'text', at: 'date' },
  },
};
