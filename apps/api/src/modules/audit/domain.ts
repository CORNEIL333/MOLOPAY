import { createHash, timingSafeEqual } from 'node:crypto';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError, type ErrorCode } from '@achat/contracts';

export const AUDIT_EVENT_TYPES = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT',
  'PERMISSION_CHANGED',
  'SENSITIVE_DATA_READ',
  'FINANCIAL_HISTORY_READ',
  'BACKOFFICE_ACTION',
  'CONFIG_CHANGED',
  'EXPORT_CREATED',
  'IDENTITY_ACTION',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditOutcome = 'SUCCESS' | 'DENIED' | 'ERROR';

export type AuditEventDraft = {
  readonly id: string;
  readonly ts: string;
  readonly eventType: AuditEventType;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly outcome: AuditOutcome;
  readonly reason?: string;
  readonly refs?: Readonly<Record<string, JsonValue>>;
};

export type AuditEventContent = {
  readonly seq: number;
  readonly id: string;
  readonly ts: string;
  readonly eventType: AuditEventType;
  readonly actorId: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly outcome: AuditOutcome;
  readonly reason: string | null;
  readonly refs: Readonly<Record<string, JsonValue>>;
};

export type AuditEventRecord = AuditEventContent & {
  readonly prevHash: Buffer;
  readonly eventHash: Buffer;
};

export type AuditListQuery = {
  readonly afterSeq: number | null;
  readonly limit: number;
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly eventType: AuditEventType | null;
};

export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HASH_LENGTH = 32;
const MAX_REASON_LENGTH = 1000;

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(AUDIT_EVENT_TYPES);
const ALLOWED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'afterSeq',
  'limit',
  'actorId',
  'targetId',
  'eventType',
]);
const REASON_REQUIRED_TYPES: ReadonlySet<AuditEventType> = new Set([
  'SENSITIVE_DATA_READ',
  'FINANCIAL_HISTORY_READ',
]);
const OUTCOMES: ReadonlySet<string> = new Set(['SUCCESS', 'DENIED', 'ERROR']);

// Refus par défaut : chaque action n'accepte que les clés listées ici, et
// uniquement des valeurs scalaires. Une action absente de registre est
// refusée : ajouter une action exige de déclarer ses références.
const IDENTITY_REF_KEYS = [
  'account_id',
  'device_id',
  'challenge_id',
  'operation_id',
] as const;
const ADMIN_REF_KEYS = [
  'kind',
  'status',
  'maker_id',
  'checker_id',
  'payload_sha256',
] as const;
const ADMIN_ACTION_PATTERN =
  /^(?:SETTLEMENT|REFUND|LEDGER_REVERSAL|FINANCIAL_SETTING|PARTNER_APPROVAL|ROLE_GRANT|BREAK_GLASS)_(?:REQUESTED|APPROVED|REJECTED|CANCELLED)$/;

const ALLOWED_REF_KEYS_BY_ACTION: ReadonlyMap<string, ReadonlySet<string>> =
  new Map(
    Object.entries({
      SESSION_OPEN: ['ip'],
      SESSION_CLOSE: ['ip'],
      LOGIN_SEEN: ['session'],
      LOGOUT_SEEN: [],
      PLAN_PRICE_UPDATE: ['plan_id'],
      READ_FINANCIAL_HISTORY: ['client_id', 'ip'],
      READ_IDENTITY_DOCUMENT: ['client_id', 'ip'],
      OTP_ISSUED: IDENTITY_REF_KEYS,
      OTP_VERIFIED: IDENTITY_REF_KEYS,
      OTP_FAILED: IDENTITY_REF_KEYS,
      PIN_SET: IDENTITY_REF_KEYS,
      PIN_VERIFIED: IDENTITY_REF_KEYS,
      PIN_FAILED: IDENTITY_REF_KEYS,
      PIN_LOCKED: IDENTITY_REF_KEYS,
      DEVICE_REGISTERED: IDENTITY_REF_KEYS,
      DEVICE_REVOKED: IDENTITY_REF_KEYS,
      ACCOUNT_BLOCKED: IDENTITY_REF_KEYS,
      SESSION_CREATED: IDENTITY_REF_KEYS,
      SESSION_REVOKED: IDENTITY_REF_KEYS,
      TRANSACTION_AUTHORIZED: IDENTITY_REF_KEYS,
      TRANSACTION_DENIED: IDENTITY_REF_KEYS,
      RECOVERY_REQUESTED: IDENTITY_REF_KEYS,
      RECOVERY_COMPLETED: IDENTITY_REF_KEYS,
    }).map(
      ([action, keys]): [string, ReadonlySet<string>] => [
        action,
        new Set(keys),
      ],
    ),
  );
const ADMIN_ALLOWED_REF_KEYS: ReadonlySet<string> = new Set(ADMIN_REF_KEYS);

function fail(code: ErrorCode, message: string): never {
  throw new BusinessError(code, message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('AUDIT_INVALID_EVENT', `${field} ne doit pas être vide`);
  }
}

export function auditEventRequiresReason(eventType: AuditEventType): boolean {
  return REASON_REQUIRED_TYPES.has(eventType);
}

function readQueryValue(
  raw: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  const value = raw[key];
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    fail('AUDIT_INVALID_EVENT', `${key} doit être une valeur unique`);
  }
  return value;
}

function readFilter(raw: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = readQueryValue(raw, key);
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  assertNonEmpty(trimmed, key);
  if (trimmed.length > 200) {
    fail('AUDIT_INVALID_EVENT', `${key} dépasse 200 caractères`);
  }
  return trimmed;
}

export function parseAuditListQuery(
  raw: Readonly<Record<string, unknown>>,
): AuditListQuery {
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      fail('AUDIT_INVALID_EVENT', `Paramètre de requête inconnu: ${key}`);
    }
  }
  const afterSeqText = readQueryValue(raw, 'afterSeq');
  let afterSeq: number | null = null;
  if (afterSeqText !== null) {
    if (!/^\d+$/.test(afterSeqText)) {
      fail('AUDIT_INVALID_EVENT', 'afterSeq doit être un entier positif');
    }
    afterSeq = Number(afterSeqText);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      fail('AUDIT_INVALID_EVENT', 'afterSeq doit être un entier sûr >= 0');
    }
  }

  const limitText = readQueryValue(raw, 'limit');
  let limit = AUDIT_DEFAULT_LIMIT;
  if (limitText !== null) {
    if (!/^\d+$/.test(limitText)) {
      fail('AUDIT_INVALID_EVENT', 'limit doit être un entier');
    }
    limit = Number(limitText);
    if (limit < 1 || limit > AUDIT_MAX_LIMIT) {
      fail(
        'AUDIT_INVALID_EVENT',
        `limit doit être compris entre 1 et ${AUDIT_MAX_LIMIT.toString()}`,
      );
    }
  }

  const eventTypeText = readQueryValue(raw, 'eventType');
  let eventType: AuditEventType | null = null;
  if (eventTypeText !== null) {
    if (!EVENT_TYPE_SET.has(eventTypeText)) {
      fail(
        'AUDIT_INVALID_EVENT',
        `Type d’événement non déclaré: ${eventTypeText}`,
      );
    }
    eventType = eventTypeText as AuditEventType;
  }

  return {
    afterSeq,
    limit,
    actorId: readFilter(raw, 'actorId'),
    targetId: readFilter(raw, 'targetId'),
    eventType,
  };
}

export function genesisAuditPrevHash(): Buffer {
  return Buffer.alloc(HASH_LENGTH);
}

function normalizeReason(
  eventType: AuditEventType,
  reason: string | undefined | null,
): string | null {
  if (reason === undefined || reason === null) {
    if (auditEventRequiresReason(eventType)) {
      fail(
        'AUDIT_REASON_REQUIRED',
        'Une consultation de données sensibles exige un motif',
      );
    }
    return null;
  }
  if (typeof reason !== 'string') {
    fail('AUDIT_INVALID_EVENT', 'reason doit être une chaîne');
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    if (auditEventRequiresReason(eventType)) {
      fail(
        'AUDIT_REASON_REQUIRED',
        'Une consultation de données sensibles exige un motif',
      );
    }
    return null;
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    fail(
      'AUDIT_INVALID_EVENT',
      `reason dépasse ${MAX_REASON_LENGTH.toString()} caractères`,
    );
  }
  return trimmed;
}

function assertAllowedRefs(
  action: string,
  refs: Readonly<Record<string, JsonValue>>,
): void {
  const allowed =
    ALLOWED_REF_KEYS_BY_ACTION.get(action) ??
    (ADMIN_ACTION_PATTERN.test(action) ? ADMIN_ALLOWED_REF_KEYS : null);
  if (allowed === null) {
    fail('AUDIT_INVALID_EVENT', `Action d’audit non déclarée: ${action}`);
  }
  for (const [key, value] of Object.entries(refs)) {
    if (!allowed.has(key)) {
      fail(
        'AUDIT_REFS_FORBIDDEN',
        `Clé de référence non autorisée pour ${action}: ${key}`,
      );
    }
    const scalar =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isSafeInteger(value));
    if (!scalar) {
      fail(
        'AUDIT_REFS_FORBIDDEN',
        `Référence non scalaire pour ${action}: ${key}`,
      );
    }
  }
}

function normalizeContent(content: AuditEventContent): AuditEventContent {
  if (!Number.isSafeInteger(content.seq) || content.seq < 1) {
    fail('AUDIT_INVALID_EVENT', 'seq doit être un entier sûr >= 1');
  }
  if (!UUID_V7_PATTERN.test(content.id)) {
    fail('AUDIT_INVALID_EVENT', 'id doit être un UUID v7 minuscule');
  }
  if (
    !ISO_UTC_MS_PATTERN.test(content.ts) ||
    Number.isNaN(new Date(content.ts).getTime()) ||
    new Date(content.ts).toISOString() !== content.ts
  ) {
    fail(
      'AUDIT_INVALID_EVENT',
      'ts doit être un horodatage ISO 8601 UTC avec millisecondes',
    );
  }
  if (!EVENT_TYPE_SET.has(content.eventType)) {
    fail(
      'AUDIT_INVALID_EVENT',
      `Type d’événement non déclaré: ${String(content.eventType)}`,
    );
  }
  assertNonEmpty(content.actorId, 'actorId');
  assertNonEmpty(content.action, 'action');
  assertNonEmpty(content.targetType, 'targetType');
  assertNonEmpty(content.targetId, 'targetId');
  if (!OUTCOMES.has(content.outcome)) {
    fail(
      'AUDIT_INVALID_EVENT',
      `Résultat non déclaré: ${String(content.outcome)}`,
    );
  }
  if (
    typeof content.refs !== 'object' ||
    content.refs === null ||
    Array.isArray(content.refs)
  ) {
    fail('AUDIT_INVALID_EVENT', 'refs doit être un objet JSON');
  }
  const reason = normalizeReason(content.eventType, content.reason);
  assertAllowedRefs(content.action, content.refs);
  return {
    ...content,
    reason,
  };
}

function canonicalPayload(content: AuditEventContent): string {
  return canonicalize({
    action: content.action,
    actor_id: content.actorId,
    event_type: content.eventType,
    id: content.id,
    outcome: content.outcome,
    reason: content.reason,
    refs: content.refs,
    seq: content.seq,
    target_id: content.targetId,
    target_type: content.targetType,
    ts: content.ts,
  });
}

export function canonicalAuditContent(content: AuditEventContent): string {
  const normalized = normalizeContent(content);
  try {
    return canonicalPayload(normalized);
  } catch (error: unknown) {
    fail(
      'AUDIT_INVALID_EVENT',
      `Métadonnées non canonisables: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function hashEvent(prevHash: Buffer, canonical: string): Buffer {
  return createHash('sha256')
    .update(prevHash)
    .update(canonical, 'utf8')
    .digest();
}

export function createAuditEvent(
  draft: AuditEventDraft,
  seq: number,
  prevHash: Uint8Array,
): AuditEventRecord {
  const previous = Buffer.from(prevHash);
  if (previous.length !== HASH_LENGTH) {
    fail(
      'AUDIT_INVALID_EVENT',
      `prevHash doit faire ${HASH_LENGTH.toString()} octets`,
    );
  }
  const content = normalizeContent({
    seq,
    id: draft.id,
    ts: draft.ts,
    eventType: draft.eventType,
    actorId: draft.actorId,
    action: draft.action,
    targetType: draft.targetType,
    targetId: draft.targetId,
    outcome: draft.outcome,
    reason: draft.reason ?? null,
    refs: draft.refs ?? {},
  });
  const eventHash = hashEvent(previous, canonicalAuditContent(content));
  return {
    ...content,
    prevHash: previous,
    eventHash,
  };
}

function sameHash(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyAuditChain(records: readonly AuditEventRecord[]): void {
  let previous = genesisAuditPrevHash();
  const seenIds = new Set<string>();
  for (const [index, record] of records.entries()) {
    const expectedSeq = index + 1;
    if (record.seq !== expectedSeq) {
      fail(
        'AUDIT_SEQUENCE_GAP',
        `Séquence attendue ${expectedSeq.toString()}, reçue ${record.seq.toString()}`,
      );
    }
    const canonical = canonicalAuditContent(record);
    if (seenIds.has(record.id)) {
      fail('AUDIT_INVALID_EVENT', `Identifiant dupliqué: ${record.id}`);
    }
    seenIds.add(record.id);
    if (!sameHash(record.prevHash, previous)) {
      fail(
        'AUDIT_CHAIN_BROKEN',
        `prevHash incohérent à la séquence ${record.seq.toString()}`,
      );
    }
    const computed = hashEvent(previous, canonical);
    if (!sameHash(record.eventHash, computed)) {
      fail(
        'AUDIT_CHAIN_BROKEN',
        `eventHash recalculé différent à la séquence ${record.seq.toString()}`,
      );
    }
    previous = Buffer.from(record.eventHash);
  }
}
