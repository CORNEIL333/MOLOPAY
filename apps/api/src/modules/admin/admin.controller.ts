import { Body, Controller, Header, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../../http/database';
import type { HttpRequest } from '../../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../../http/staff-session.guard';
import { decideApproval, prepareApproval } from './approval.store';
import { assertAuthorized, INTERNAL_ROLES, type AdminPrincipal, type InternalRole } from './domain';
import { publishApprovedSetting } from './setting.store';
import { insertRoleGrant, insertStaffAccount, insertStaffDisable, issueEnrollment } from './staff.store';

type Result = { readonly status: number; readonly body: JsonValue };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOGIN = /^[a-z][a-z0-9._-]{2,63}$/;
const SETTING_KEY = /^[a-z][a-z0-9_]{2,63}$/;
/** Types de demandes ouverts en HTTP : rôles internes et paramètres financiers. */
const HTTP_KINDS = ['ROLE_GRANT', 'FINANCIAL_SETTING'] as const;

function invalid(message = 'Corps de requête invalide'): never {
  throw new BusinessError('REQUEST_INVALID', message);
}

function fields(body: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    invalid();
  }
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value);
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => required.includes(key) || optional.includes(key))) {
    invalid('Champs non autorisés ou manquants');
  }
  return value;
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    invalid('Valeur invalide');
  }
  return value;
}

function reasonText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1000) {
    invalid('Motif obligatoire (1 à 1000 caractères)');
  }
  return value;
}

/**
 * SEC-AUTHZ-003 / D62 : administration du back-office. Toute création de
 * compte, attribution de rôles ou publication d'un paramètre financier passe
 * par une demande préparée puis approuvée par une autre personne ; la base
 * vérifie que l'acte reprend exactement la demande approuvée.
 */
@Controller('v1/backoffice/admin')
@UseGuards(StaffSessionGuard)
export class AdminController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  private async run(staff: AdminPrincipal, request: HttpRequest, scope: string, fingerprint: JsonValue, command: (client: PoolClient) => Promise<Result>): Promise<JsonValue> {
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `${scope}:${staff.actorId}`, key, request: fingerprint }, command);
    return result.body;
  }

  @Post('approvals')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public prepare(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const value = fields(body, ['id', 'kind', 'payload', 'reason']);
    const id = text(value['id'], UUID_V7);
    const kind = value['kind'];
    if (typeof kind !== 'string' || !(HTTP_KINDS as readonly string[]).includes(kind)) {
      invalid('Type de demande non ouvert en HTTP');
    }
    const payload = value['payload'];
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      invalid('Charge objet attendue');
    }
    const reason = reasonText(value['reason']);
    return this.run(staff, request, 'bo-approval-prepare', { id, kind, payload: payload as JsonValue, reason }, async (client) => {
      const prepared = await prepareApproval(client, {
        id,
        kind: kind as (typeof HTTP_KINDS)[number],
        payload: payload as Record<string, JsonValue>,
        reason,
        principal: staff,
      });
      return { status: 201, body: { requestId: prepared.id, kind: prepared.kind, expiresAt: prepared.expiresAt } };
    });
  }

  @Post('approvals/:requestId/decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public decide(@CurrentStaff() staff: AdminPrincipal, @Param('requestId') requestId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const id = text(requestId, UUID);
    const value = fields(body, ['decision'], ['reason']);
    const decision = value['decision'];
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      invalid('Décision APPROVED ou REJECTED attendue');
    }
    const reason = value['reason'] === undefined ? undefined : reasonText(value['reason']);
    return this.run(staff, request, `bo-approval-decision:${id}`, { decision, reason: reason ?? null }, async (client) => {
      await decideApproval(client, { requestId: id, principal: staff, decision, reason });
      return { status: 200, body: { requestId: id, decision } };
    });
  }

  @Post('staff')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public createStaff(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    assertAuthorized(staff, 'MANAGE_USERS', {});
    const value = fields(body, ['staffId', 'login', 'approvalRequestId']);
    const staffId = text(value['staffId'], UUID_V7);
    const login = text(value['login'], LOGIN);
    const approvalRequestId = text(value['approvalRequestId'], UUID);
    return this.run(staff, request, 'bo-staff-create', { staffId, login, approvalRequestId }, async (client) => {
      await insertStaffAccount(client, { id: staffId, login, approvalRequestId });
      return { status: 201, body: { staffId, login } };
    });
  }

  @Post('staff/:staffId/roles')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public grantRoles(@CurrentStaff() staff: AdminPrincipal, @Param('staffId') staffId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    assertAuthorized(staff, 'MANAGE_USERS', {});
    const id = text(staffId, UUID);
    const value = fields(body, ['roles', 'cityIds', 'maxAmountXaf', 'approvalRequestId']);
    const roles = value['roles'];
    const cityIds = value['cityIds'];
    if (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string' && (INTERNAL_ROLES as readonly string[]).includes(role))) {
      invalid('Rôles inconnus');
    }
    if (!Array.isArray(cityIds) || !cityIds.every((city) => city === 'yaounde' || city === 'douala')) {
      invalid('Villes inconnues');
    }
    const max = value['maxAmountXaf'];
    if (max !== null && (typeof max !== 'string' || !/^[1-9][0-9]{0,15}$/.test(max))) {
      invalid('Plafond entier en FCFA (chaîne) ou null');
    }
    const approvalRequestId = text(value['approvalRequestId'], UUID);
    return this.run(staff, request, `bo-staff-roles:${id}`, { roles: roles as string[], cityIds: cityIds as string[], max, approvalRequestId }, async (client) => {
      await insertRoleGrant(client, {
        staffId: id,
        roles: roles as InternalRole[],
        cityIds: cityIds as string[],
        maxAmountXaf: max === null ? null : BigInt(max),
        approvalRequestId,
      });
      return { status: 201, body: { staffId: id, roles: roles as string[] } };
    });
  }

  @Post('staff/:staffId/disable')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public disable(@CurrentStaff() staff: AdminPrincipal, @Param('staffId') staffId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    assertAuthorized(staff, 'MANAGE_USERS', {});
    const id = text(staffId, UUID);
    const reason = reasonText(fields(body, ['reason'])['reason']);
    return this.run(staff, request, `bo-staff-disable:${id}`, { reason }, async (client) => {
      await insertStaffDisable(client, { staffId: id, actorId: staff.actorId, reason });
      return { status: 200, body: { staffId: id, disabled: true } };
    });
  }

  /**
   * Enrôlement d'une clé : le jeton (secret, à remettre en main propre) est
   * renvoyé une seule fois et n'entre jamais dans le magasin d'idempotence ;
   * un rejeu renvoie le défi sans jeton (en émettre un nouveau).
   */
  @Post('staff/:staffId/enrollments')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async enroll(@CurrentStaff() staff: AdminPrincipal, @Param('staffId') staffId: string, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    assertAuthorized(staff, 'MANAGE_USERS', {});
    const id = text(staffId, UUID);
    fields(body ?? {}, []);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    let enrollmentToken: string | null = null;
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `bo-staff-enroll:${id}:${staff.actorId}`, key, request: {} }, async (client) => {
      const issued = await issueEnrollment(client, { staffId: id, actorId: staff.actorId });
      enrollmentToken = issued.enrollmentToken;
      return { status: 201, body: { staffId: id, challengeId: issued.challengeId, challenge: issued.challenge.toString('base64url') } };
    });
    return result.replayed || enrollmentToken === null ? result.body : { ...(result.body as Record<string, JsonValue>), enrollmentToken };
  }

  @Post('settings')
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public publishSetting(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<JsonValue> {
    const value = fields(body, ['key', 'value', 'approvalRequestId']);
    const key = text(value['key'], SETTING_KEY);
    const approvalRequestId = text(value['approvalRequestId'], UUID);
    const settingValue = value['value'] as JsonValue;
    return this.run(staff, request, `bo-setting-publish:${key}`, { key, value: settingValue, approvalRequestId }, async (client) => {
      const published = await publishApprovedSetting(client, { key, value: settingValue, approvalRequestId, actorId: staff.actorId });
      return { status: 201, body: { key, version: published.version } };
    });
  }
}
