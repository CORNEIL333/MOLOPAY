import type { PoolClient } from 'pg';
import { authenticateSessionCookie, type AuthenticatedCustomer } from './session.store';
import { BusinessError } from '@achat/contracts';
import type { components } from '@achat/contracts/api';
import { appendAuditEvent } from '../audit/audit.store';

export type SecurityAction = 'REVOKE_OTHERS' | 'SIGN_OUT' | 'BLOCK';
export function assertSecurityBody(action: SecurityAction, body: unknown): void {
  const invalid = (): never => { throw new BusinessError('REQUEST_INVALID'); };
  if (body === undefined && action !== 'BLOCK') return;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return invalid();
  const keys = Reflect.ownKeys(body);
  if (action !== 'BLOCK') { if (keys.length !== 0) invalid(); return; }
  const reason = Object.getOwnPropertyDescriptor(body, 'reason');
  if (keys.length !== 1 || keys[0] !== 'reason' || reason === undefined || !Object.hasOwn(reason, 'value')
    || reason.value !== 'LOST_OR_STOLEN') invalid();
}
export async function readAccountSecurity(client: PoolClient, actor: AuthenticatedCustomer): Promise<components['schemas']['AccountSecurity']> {
  const result = await client.query<{ as_of: Date; devices: components['schemas']['AccountSecurity']['devices']; sessions: components['schemas']['AccountSecurity']['sessions'] }>(
    `SELECT statement_timestamp() AS as_of,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('deviceId',d.id,'name',d.name,'status',d.status,'registeredAt',d.registered_at,'current',d.id=$2) ORDER BY d.registered_at DESC,d.id)
        FROM identity.device d WHERE d.account_id=$1), '[]'::jsonb) AS devices,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('sessionId',s.id,'deviceName',d.name,'createdAt',s.created_at,
        'accessExpiresAt',s.access_expires_at,'refreshExpiresAt',s.refresh_expires_at,'current',s.id=$3) ORDER BY s.created_at DESC,s.id)
        FROM identity.session s JOIN identity.device d ON d.id=s.device_id AND d.account_id=s.account_id
        WHERE s.account_id=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>statement_timestamp() AND d.status='ACTIVE'), '[]'::jsonb) AS sessions
      FROM identity.session current_session JOIN identity.account a ON a.id=current_session.account_id
      JOIN identity.device current_device ON current_device.id=current_session.device_id AND current_device.account_id=a.id
      WHERE current_session.id=$3 AND a.id=$1 AND current_device.id=$2 AND a.status='ACTIVE' AND current_device.status='ACTIVE'
        AND current_session.revoked_at IS NULL AND current_session.access_expires_at>clock_timestamp()`,
    [actor.accountId, actor.deviceId, actor.sessionId]);
  const row = result.rows[0];
  if (row === undefined) throw new BusinessError('IDENTITY_SESSION_INVALID');
  return { devices: row.devices, sessions: row.sessions, asOf: row.as_of.toISOString() };
}
export async function mutateAccountSecurity(client: PoolClient, actor: AuthenticatedCustomer, cookie: string | undefined, action: SecurityAction): Promise<{ affectedSessions: number; occurredAt: string }> {
  const args = [actor.accountId, actor.deviceId, actor.sessionId];
  await client.query('SELECT identity.lock_security_actor($1,$2,$3)', args);
  const fresh = await authenticateSessionCookie(client, cookie);
  if (fresh.accountId !== actor.accountId || fresh.deviceId !== actor.deviceId || fresh.sessionId !== actor.sessionId) {
    throw new BusinessError('IDENTITY_SESSION_INVALID');
  }
  const result = await client.query<{ affected_sessions: number; occurred_at: Date }>(
    'SELECT * FROM identity.apply_security_action($1,$2,$3,$4)', [...args, action]);
  const row = result.rows[0];
  if (row === undefined || !Number.isSafeInteger(row.affected_sessions) || row.affected_sessions < 0) throw new Error('IDENTITY_SECURITY_FAILED');
  await appendAuditEvent(client, { eventType: action === 'SIGN_OUT' ? 'AUTH_LOGOUT' : 'IDENTITY_ACTION',
    actorId: actor.accountId, action: action === 'BLOCK' ? 'ACCOUNT_BLOCKED' : 'SESSION_REVOKED',
    targetType: action === 'SIGN_OUT' ? 'SESSION' : 'ACCOUNT', targetId: action === 'SIGN_OUT' ? actor.sessionId : actor.accountId,
    outcome: 'SUCCESS', reason: action === 'BLOCK' ? 'LOST_OR_STOLEN' : action,
    refs: { account_id: actor.accountId, device_id: actor.deviceId } });
  return { affectedSessions: row.affected_sessions, occurredAt: row.occurred_at.toISOString() };
}
