/**
 * Test helper: wraps a DataStore so every write is checked against a mirror of the entities' row-level security,
 * as the deployed GraphQL API would check it for the signed-in `sub`. Used by the workflow tests to prove the
 * domain only makes writes the database will accept.
 */
import type { BaseRow, DataStore, Repo } from '@x10/shared/data';

import type { EndorsementRequest, Schema } from '../model';
import { canCreateRequestRow, canWriteRequestRow, REQUEST_CREATE_EXCLUDED, REQUEST_UPDATE_EXCLUDED } from './policies';

export class PolicyViolation extends Error {}

function present(obj: object, keys: readonly string[]): string[] {
  return keys.filter((k) => k in obj && (obj as Record<string, unknown>)[k] !== undefined);
}

export function policyStore(inner: DataStore<Schema>, sub: string): DataStore<Schema> {
  function repo<K extends keyof Schema & string>(name: K): Repo<Schema[K] & BaseRow> {
    const base = inner.repo(name) as unknown as Repo<BaseRow>;
    const wrapped: Repo<BaseRow> = { ...base };
    if (name === 'EndorsementRequest') {
      wrapped.create = async (data) => {
        const row = data as unknown as EndorsementRequest;
        if (!canCreateRequestRow(sub, row)) throw new PolicyViolation('create policy: ownerSub must be you and status submitted');
        const bad = present(data, REQUEST_CREATE_EXCLUDED);
        if (bad.length) throw new PolicyViolation(`create sends excluded fields: ${bad.join(', ')}`);
        return base.create(data);
      };
      wrapped.update = async (id, patch) => {
        const row = (await base.get(id)) as unknown as EndorsementRequest | null;
        if (!row || !canWriteRequestRow(sub, row)) throw new PolicyViolation('update policy: not owner, reviewer or submitted');
        const bad = present(patch, REQUEST_UPDATE_EXCLUDED);
        if (bad.length) throw new PolicyViolation(`update sends excluded fields: ${bad.join(', ')}`);
        return base.update(id, patch);
      };
      wrapped.remove = async () => {
        throw new PolicyViolation('EndorsementRequest has no delete permission');
      };
    }
    if (name === 'ChecklistAnswer' || name === 'EndorsementEvent') {
      const stamp = name === 'ChecklistAnswer' ? 'answeredBySub' : 'bySub';
      wrapped.create = async (data) => {
        if ((data as Record<string, unknown>)[stamp] !== sub) throw new PolicyViolation(`${name} create must be stamped with your sub`);
        return base.create(data);
      };
      wrapped.update = async () => {
        throw new PolicyViolation(`${name} is append-only (no update)`);
      };
      wrapped.remove = async () => {
        throw new PolicyViolation(`${name} is append-only (no delete)`);
      };
    }
    return wrapped as unknown as Repo<Schema[K] & BaseRow>;
  }
  return { kind: inner.kind, repo: repo as DataStore<Schema>['repo'] };
}
