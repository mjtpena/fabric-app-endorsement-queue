/**
 * Request form validation, duplicate detection and read-side loaders.
 */
import { NotFoundError, RuleError, type DataStore } from '@x10/shared/data';
import { checkText, isHttpUrl, normKey, type Errors } from '@x10/shared/lib';

import { limits, type ChecklistAnswer, type EndorsementEvent, type EndorsementRequest, type Level, type Schema, type Status } from '../model';

export const OPEN_STATUSES: readonly Status[] = ['submitted', 'in_review', 'changes_requested'];

export const isOpen = (s: Status) => OPEN_STATUSES.includes(s);

export interface RequestInput {
  modelName: string;
  workspace: string;
  modelUrl: string;
  requestedLevel: Level | '';
  justification: string;
}

export function emptyInput(): RequestInput {
  return { modelName: '', workspace: '', modelUrl: '', requestedLevel: '', justification: '' };
}

/** Inline validation with the entity limits. */
export function validateRequestInput(v: RequestInput): Errors<RequestInput> {
  const out: Errors<RequestInput> = {};
  const name = checkText(v.modelName, { ...limits.modelName, label: 'Model name' });
  if (name) out.modelName = name;
  const ws = checkText(v.workspace, { ...limits.workspace, label: 'Workspace' });
  if (ws) out.workspace = ws;
  const url = v.modelUrl.trim();
  if (url) {
    if (url.length > limits.modelUrl.max) out.modelUrl = `Link must be ${limits.modelUrl.max} characters or fewer.`;
    else if (!isHttpUrl(url)) out.modelUrl = 'Enter a full link starting with https://';
  }
  if (v.requestedLevel !== 'promoted' && v.requestedLevel !== 'certified') out.requestedLevel = 'Choose a level.';
  const j = checkText(v.justification, { ...limits.justification, label: 'Justification' });
  if (j) out.justification = j;
  return out;
}

/** Same model in the same workspace, compared without case or extra spaces. */
export const modelKey = (r: { modelName: string; workspace: string }) => `${normKey(r.modelName)}|${normKey(r.workspace)}`;

/** An open request for the same model and workspace, if any. */
export function findOpenDuplicate(
  requests: EndorsementRequest[],
  input: { modelName: string; workspace: string },
): EndorsementRequest | null {
  const key = modelKey(input);
  return requests.find((r) => isOpen(r.status) && modelKey(r) === key) ?? null;
}

/** Thrown when an open request already exists for the model; the UI links to it. */
export class DuplicateRequestError extends RuleError {
  constructor(readonly existing: EndorsementRequest) {
    super(`"${existing.modelName}" in ${existing.workspace} already has an open request. Follow that one instead.`);
    this.name = 'DuplicateRequestError';
  }
}

/** Form values for a renewal, prefilled from the approved request it renews. */
export function renewalInput(old: EndorsementRequest): RequestInput {
  return {
    modelName: old.modelName,
    workspace: old.workspace,
    modelUrl: old.modelUrl ?? '',
    requestedLevel: old.requestedLevel,
    justification: `Renewal of the ${old.requestedLevel} endorsement approved on ${old.decidedAt?.slice(0, 10) ?? 'an earlier date'}. ${old.justification}`.slice(
      0,
      limits.justification.max,
    ),
  };
}

/* ------------------------------------------------------------------ loaders */

export async function listRequests(store: DataStore<Schema>): Promise<EndorsementRequest[]> {
  return store.repo('EndorsementRequest').list({ orderBy: { field: 'submittedAt', dir: 'desc' } });
}

export async function listMyRequests(store: DataStore<Schema>, sub: string): Promise<EndorsementRequest[]> {
  return store.repo('EndorsementRequest').list({ where: { ownerSub: sub }, orderBy: { field: 'submittedAt', dir: 'desc' } });
}

export async function listAllEvents(store: DataStore<Schema>): Promise<EndorsementEvent[]> {
  return store.repo('EndorsementEvent').list({ orderBy: { field: 'at', dir: 'asc' } });
}

/** Events of one request, oldest first. */
export async function listEvents(store: DataStore<Schema>, requestId: string): Promise<EndorsementEvent[]> {
  return store.repo('EndorsementEvent').list({ where: { requestId }, orderBy: { field: 'at', dir: 'asc' } });
}

export async function listAnswers(store: DataStore<Schema>, requestId: string): Promise<ChecklistAnswer[]> {
  return store.repo('ChecklistAnswer').list({ where: { requestId }, orderBy: { field: 'answeredAt', dir: 'asc' } });
}

/** Subs of the people marked as admins (reviewers). isAdmin can only be set with SQL. */
export async function listAdminSubs(store: DataStore<Schema>): Promise<Set<string>> {
  const people = await store.repo('Person').list();
  return new Set(people.filter((p) => p.isAdmin === true).map((p) => p.sub));
}

export async function getRequest(store: DataStore<Schema>, id: string): Promise<EndorsementRequest> {
  const r = await store.repo('EndorsementRequest').get(id);
  if (!r) throw new NotFoundError('Request', id);
  return r;
}

export interface RequestBundle {
  request: EndorsementRequest;
  answers: ChecklistAnswer[];
  events: EndorsementEvent[];
  /** The request this one renews, if any. */
  renewalOf: EndorsementRequest | null;
  /** Subs of admins, to judge which trail events count. */
  adminSubs: Set<string>;
}

export async function getRequestBundle(store: DataStore<Schema>, id: string): Promise<RequestBundle> {
  const request = await getRequest(store, id);
  const [answers, events, renewalOf, adminSubs] = await Promise.all([
    listAnswers(store, id),
    listEvents(store, id),
    request.renewalOfId ? store.repo('EndorsementRequest').get(request.renewalOfId) : Promise.resolve(null),
    listAdminSubs(store),
  ]);
  return { request, answers, events, renewalOf, adminSubs };
}
