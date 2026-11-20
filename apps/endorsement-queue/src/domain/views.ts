/** Loaders that shape data for one screen each. Pages call these; they never touch the store directly. */
import { groupBy, type DataStore } from '@x10/shared/data';

import type { EndorsementEvent, EndorsementRequest, Schema } from '../model';
import { checkIntegrity } from './integrity';
import { listAdminSubs, listMyRequests, listRequests } from './requests';
import { failedItems, latestReviewerComment } from './workflow';

export interface MyRequestRow {
  request: EndorsementRequest;
  comment: EndorsementEvent | null;
  /** Items the reviewer failed, while changes are requested. */
  toFix: number;
  /** First integrity issue (row does not match its trail), if any. */
  issue: string | null;
}

export async function loadMyRequests(store: DataStore<Schema>, sub: string): Promise<MyRequestRow[]> {
  const requests = await listMyRequests(store, sub);
  const ids = new Set(requests.map((r) => r.id));
  const [events, answers, admins] = await Promise.all([
    store.repo('EndorsementEvent').list({ orderBy: { field: 'at', dir: 'asc' } }),
    store.repo('ChecklistAnswer').list({ where: { stage: 'review' } }),
    listAdminSubs(store),
  ]);
  const evByReq = groupBy(events.filter((e) => ids.has(e.requestId)), (e) => e.requestId);
  const ansByReq = groupBy(answers.filter((a) => ids.has(a.requestId)), (a) => a.requestId);
  return requests.map((r) => ({
    request: r,
    comment: latestReviewerComment(r, evByReq.get(r.id) ?? [], admins),
    toFix: r.status === 'changes_requested' ? failedItems(r, ansByReq.get(r.id) ?? []).length : 0,
    issue: checkIntegrity(r, evByReq.get(r.id) ?? [], admins).issues[0] ?? null,
  }));
}

export interface QueueData {
  requests: EndorsementRequest[];
  /** First integrity issue per request id, for requests whose row does not match the trail. */
  issues: Map<string, string>;
}

/** Every request (the queue filters in memory), with rows that do not match their trail flagged. */
export async function loadQueue(store: DataStore<Schema>): Promise<QueueData> {
  const [requests, events, admins] = await Promise.all([
    listRequests(store),
    store.repo('EndorsementEvent').list({ orderBy: { field: 'at', dir: 'asc' } }),
    listAdminSubs(store),
  ]);
  const byReq = groupBy(events, (e) => e.requestId);
  const issues = new Map<string, string>();
  for (const r of requests) {
    const first = checkIntegrity(r, byReq.get(r.id) ?? [], admins).issues[0];
    if (first) issues.set(r.id, first);
  }
  return { requests, issues };
}
