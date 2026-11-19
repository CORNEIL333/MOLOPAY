import { ERROR_CODES, type ErrorCode } from '@achat/contracts';

/** Jeton d'injection du puits de journal (explicite, sans métadonnées). */
export const LOG_SINK = Symbol('LOG_SINK');

/** Destination des lignes de journal déjà sérialisées. */
export type LogSink = {
  write(line: string): void;
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Enregistrement de journal à liste blanche fermée : aucun champ libre, aucune
 * donnée sensible. Les champs absents ne sont pas écrits.
 */
export type LogRecord = {
  readonly level: LogLevel;
  readonly event: string;
  readonly correlationId: string;
  readonly method?: string;
  readonly path?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly code?: ErrorCode;
  readonly errorName?: string;
  /** Numéro complet : masqué à la sérialisation (4 derniers chiffres). */
  readonly phone?: string;
};

export type LogRecordErrorCode = 'LOG_FIELD_FORBIDDEN' | 'LOG_RECORD_INVALID';

/** Enregistrement refusé : la journalisation ne doit jamais divulguer ni bloquer. */
export class LogRecordError extends Error {
  public constructor(public readonly code: LogRecordErrorCode) {
    super(code);
    this.name = 'LogRecordError';
  }
}

const FIELD_ORDER = [
  'level',
  'event',
  'correlationId',
  'method',
  'path',
  'status',
  'durationMs',
  'code',
  'errorName',
  'phone',
] as const;

const ALLOWED_FIELDS: ReadonlySet<string> = new Set<string>(FIELD_ORDER);
const LEVELS: ReadonlySet<string> = new Set<LogLevel>(['debug', 'info', 'warn', 'error']);
const METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const EVENT_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const ERROR_NAME_PATTERN = /^[A-Za-z0-9_.$-]{1,80}$/;
/** Chemin sûr : ni requête (`?`), ni caractère de contrôle, ni séparateur exotique. */
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/]*$/;
const REDACTED_PATH = '/[redacted]';
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_CODES));

function invalid(): never {
  throw new LogRecordError('LOG_RECORD_INVALID');
}

function field(record: LogRecord, key: string): unknown {
  return (record as unknown as Record<string, unknown>)[key];
}

/** Ne laisse que les quatre derniers chiffres ; jamais plus. */
export function maskPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return '****';
  if (digits.length <= 4) return digits;
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

/**
 * Sérialise un enregistrement validé en une seule ligne JSON. Toute clé hors
 * liste blanche ou toute valeur mal formée est refusée : un journal ne se
 * corrige pas après coup.
 */
export function serializeLogRecord(record: LogRecord, now: Date = new Date()): string {
  for (const key of Object.keys(record as unknown as Record<string, unknown>)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new LogRecordError('LOG_FIELD_FORBIDDEN');
    }
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) invalid();

  const level = field(record, 'level');
  if (typeof level !== 'string' || !LEVELS.has(level)) invalid();
  const event = field(record, 'event');
  if (typeof event !== 'string' || !EVENT_PATTERN.test(event)) invalid();
  const correlationId = field(record, 'correlationId');
  if (typeof correlationId !== 'string' || !CORRELATION_PATTERN.test(correlationId)) invalid();

  const output: Record<string, unknown> = {
    time: now.toISOString(),
    level,
    event,
    correlationId,
  };

  const rawMethod = field(record, 'method');
  if (rawMethod !== undefined) {
    if (typeof rawMethod !== 'string') invalid();
    output['method'] = METHODS.has(rawMethod) ? rawMethod : 'OTHER';
  }

  const rawPath = field(record, 'path');
  if (rawPath !== undefined) {
    if (typeof rawPath !== 'string') invalid();
    output['path'] = SAFE_PATH.test(rawPath) ? rawPath : REDACTED_PATH;
  }

  const rawStatus = field(record, 'status');
  if (rawStatus !== undefined) {
    if (typeof rawStatus !== 'number' || !Number.isInteger(rawStatus) || rawStatus < 100 || rawStatus > 599) {
      invalid();
    }
    output['status'] = rawStatus;
  }

  const rawDuration = field(record, 'durationMs');
  if (rawDuration !== undefined) {
    if (typeof rawDuration !== 'number' || !Number.isFinite(rawDuration) || rawDuration < 0) invalid();
    output['durationMs'] = rawDuration;
  }

  const rawCode = field(record, 'code');
  if (rawCode !== undefined) {
    if (typeof rawCode !== 'string' || !KNOWN_CODES.has(rawCode)) invalid();
    output['code'] = rawCode;
  }

  const rawErrorName = field(record, 'errorName');
  if (rawErrorName !== undefined) {
    if (typeof rawErrorName !== 'string' || !ERROR_NAME_PATTERN.test(rawErrorName)) invalid();
    output['errorName'] = rawErrorName;
  }

  const rawPhone = field(record, 'phone');
  if (rawPhone !== undefined) {
    if (typeof rawPhone !== 'string') invalid();
    output['phone'] = maskPhone(rawPhone);
  }

  return JSON.stringify(output);
}

/**
 * Écrit une ligne sans jamais faire échouer la requête : un puits absent ou
 * défaillant ne change ni la réponse ni le statut.
 */
export function emitLog(sink: LogSink | null | undefined, record: LogRecord, now: Date = new Date()): void {
  if (sink === null || sink === undefined) return;
  try {
    sink.write(serializeLogRecord(record, now));
  } catch {
    // Une erreur de journalisation ne remonte pas au client.
  }
}

/** Puits de production : une ligne JSON par événement sur la sortie standard. */
export const stdoutLogSink: LogSink = {
  write(line: string): void {
    process.stdout.write(`${line}\n`);
  },
};
