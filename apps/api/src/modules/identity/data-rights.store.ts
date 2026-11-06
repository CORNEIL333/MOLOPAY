import { BusinessError } from '@achat/contracts';
import type { components } from '@achat/contracts/api';
import type { PoolClient } from 'pg';
import { appendAuditEvent, auditUuidv7 } from '../audit/audit.store';
import { authenticateSessionCookie, type AuthenticatedCustomer } from './session.store';

export type DataRightKind = 'ACCESS' | 'RECTIFICATION' | 'OBJECTION' | 'ERASURE';
const KINDS: readonly string[] = ['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE'];
function property(body: unknown, name: string, optional = false): unknown {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BusinessError('REQUEST_INVALID');
  const keys = Reflect.ownKeys(body);
  if (keys.length === 0 && optional) return null;
  const descriptor = Object.getOwnPropertyDescriptor(body, name);
  if (keys.length !== 1 || keys[0] !== name || descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw new BusinessError('REQUEST_INVALID');
  return descriptor.value as unknown;
}
export function parseDataRight(body: unknown): DataRightKind {
  const kind = property(body, 'kind');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw new BusinessError('REQUEST_INVALID');
  return kind as DataRightKind;
}
export function parseRightsCursor(query: unknown): string | null {
  const cursor = property(query, 'before', true);
  if (cursor === null) return null;
  if (typeof cursor !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cursor)) throw new BusinessError('REQUEST_INVALID');
  return cursor;
}
type Row = { request_id: string; kind: DataRightKind; received_at: Date };
function receipt(row: Row): components['schemas']['DataRightReceipt'] {
  return { requestId: row.request_id, kind: row.kind, status: 'RECEIVED', receivedAt: row.received_at.toISOString() };
}
export async function lockDataRightsActor(client: PoolClient, actor: AuthenticatedCustomer, cookie: string | undefined): Promise<void> {
  await client.query('SELECT identity.lock_security_actor($1,$2,$3)', [actor.accountId, actor.deviceId, actor.sessionId]);
  await verifyDataRightsActor(client, actor, cookie);
}
export async function verifyDataRightsActor(client: PoolClient, actor: AuthenticatedCustomer, cookie: string | undefined): Promise<void> {
  const fresh = await authenticateSessionCookie(client, cookie);
  if (fresh.accountId !== actor.accountId || fresh.deviceId !== actor.deviceId || fresh.sessionId !== actor.sessionId) throw new BusinessError('IDENTITY_SESSION_INVALID');
}
export async function submitDataRight(client: PoolClient, actor: AuthenticatedCustomer, kind: DataRightKind): Promise<components['schemas']['DataRightReceipt']> {
  const result = await client.query<Row>('SELECT * FROM identity.submit_data_right($1,$2,$3,$4,$5)',
    [actor.accountId, actor.deviceId, actor.sessionId, auditUuidv7(), kind]);
  const row = result.rows[0];
  if (row === undefined) throw new BusinessError('INTERNAL_ERROR');
  await appendAuditEvent(client, { eventType: 'IDENTITY_ACTION', actorId: actor.accountId, action: 'DATA_RIGHTS_REQUESTED',
    targetType: 'DATA_RIGHT_REQUEST', targetId: row.request_id, outcome: 'SUCCESS', reason: kind,
    refs: { account_id: actor.accountId, device_id: actor.deviceId } });
  return receipt(row);
}
export async function listDataRights(client: PoolClient, actor: AuthenticatedCustomer, before: string | null): Promise<components['schemas']['DataRightHistory']> {
  const result = await client.query<Row>('SELECT * FROM identity.list_data_rights($1,$2,$3,$4)', [actor.accountId, actor.deviceId, actor.sessionId, before]);
  const items = result.rows.slice(0, 50).map(receipt);
  const time = await client.query<{ instant: Date }>('SELECT clock_timestamp() AS instant');
  return { items, nextBefore: result.rows.length > 50 ? items.at(-1)!.requestId : null, asOf: time.rows[0]!.instant.toISOString() };
}
