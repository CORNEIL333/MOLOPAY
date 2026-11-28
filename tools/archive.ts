import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { canonicalize, type JsonValue } from '../packages/chain/src/jcs';
import { backupDatabase, backupKeyWrapperFromEnv as keyWrapperFromEnv, restoreBackup } from './backup';
import { runVerifierBinary } from './nightly-verify';
import type { KeyWrapper } from '../apps/api/src/crypto/envelope';

/**
 * Q6 : archive signée du grand livre et de l'audit (INT-VER-001/002, INT-HASH,
 * registre T-03/T-09/T-15). L'archive ne fabrique aucune signature : elle
 * embarque l'export signé existant (têtes Ed25519, clé publique hors bande) et
 * le journal d'audit, puis un manifeste qui fige empreintes, volumes et durée
 * de conservation. L'authenticité vient de la signature des têtes, vérifiée
 * par le vérificateur Rust ; le manifeste protège l'intégrité du contenant.
 *
 * Témoins d'ancrage (D6) : aucun témoin réel n'existe encore. Le manifeste le
 * consigne (`UNCONFIGURED`) et `archive.ts witness` refuse d'en inventer un :
 * aucune archive n'est déclarée ancrée sans témoin configuré.
 */
export const ARCHIVE_VERSION = 1;
/** Durées du registre marquées « à confirmer » : la plus prudente (LBC/FT, T-02/T-09/T-15) est retenue. */
export const RETENTION_YEARS = 10;
export const RETENTION_BASIS = 'registre T-03/T-09/T-15 : ≥ 10 ans (durée à confirmer, option la plus prudente retenue)';
export const WITNESS_UNCONFIGURED = 'ANCHORING_UNCONFIGURED';

const HEX64 = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

type Json = Record<string, unknown>;

export type ArchivePayload = {
  readonly kind: 'ledger-export' | 'audit-export' | 'database-backup';
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly records: number;
};

export type ArchiveManifest = {
  readonly archive_version: 1;
  readonly created_at: string;
  readonly log_id: string;
  readonly retention: { readonly years: number; readonly basis: string; readonly until: string };
  readonly ledger: { readonly entries: number; readonly last_seq: number; readonly tree_size: number; readonly entries_sha256: string };
  readonly witnesses: { readonly status: 'UNCONFIGURED'; readonly code: string };
  readonly payloads: readonly ArchivePayload[];
};

function invalid(code: string, detail: string): never {
  throw new Error(`ARCHIVE_EXPORT_INVALID ${code}: ${detail}`);
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid('UNKNOWN_FIELD', `${where}: champ « ${key} » non admis`);
  }
}

type TreeHead = { readonly tree_size: number; readonly root_hash: string };

export type ParsedExport = {
  readonly logId: string;
  readonly entries: number;
  readonly lastSeq: number;
  readonly treeSize: number;
  readonly entriesSha256: string;
};

/** Export v1 strict : mêmes règles que le vérificateur indépendant (aucun champ inconnu). */
export function parseSignedExport(raw: string): ParsedExport {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    invalid('JSON', 'export illisible');
  }
  if (!isObject(document)) invalid('SHAPE', 'racine attendue : objet');
  onlyKeys(document, ['version', 'log_id', 'generated_at', 'entries', 'tree_heads', 'witness_heads'], 'racine');
  if (document['version'] !== 1) invalid('VERSION', 'version 1 attendue');
  const logId = document['log_id'];
  if (typeof logId !== 'string' || logId === '') invalid('LOG_ID', 'log_id attendu');
  const generatedAt = document['generated_at'];
  if (typeof generatedAt !== 'string' || !INSTANT.test(generatedAt)) invalid('GENERATED_AT', 'generated_at ISO 8601 attendu');
  const entries = document['entries'];
  if (!Array.isArray(entries) || entries.length === 0) invalid('ENTRIES', 'écritures attendues');
  let lastSeq = 0;
  for (const entry of entries) {
    if (!isObject(entry)) invalid('ENTRY', 'écriture attendue : objet');
    if (!Number.isInteger(entry['seq']) || (entry['seq'] as number) !== lastSeq + 1) invalid('SEQ', `séquence attendue ${lastSeq + 1}`);
    lastSeq = entry['seq'] as number;
    if (typeof entry['entry_hash'] !== 'string' || !HEX64.test(entry['entry_hash'])) invalid('ENTRY_HASH', `écriture ${lastSeq}`);
  }
  const heads = document['tree_heads'];
  if (!Array.isArray(heads) || heads.length === 0) invalid('TREE_HEADS', 'au moins une tête signée attendue');
  const parsedHeads: TreeHead[] = heads.map((head) => {
    if (!isObject(head)) invalid('TREE_HEAD', 'tête attendue : objet');
    onlyKeys(head, ['tree_size', 'root_hash', 'timestamp', 'log_id', 'signature'], 'tête');
    const size = head['tree_size'];
    if (!Number.isInteger(size) || (size as number) <= 0) invalid('TREE_SIZE', 'tree_size entier positif attendu');
    if (typeof head['root_hash'] !== 'string' || !HEX64.test(head['root_hash'])) invalid('ROOT_HASH', 'root_hash 64 hex attendu');
    if (typeof head['timestamp'] !== 'string' || !INSTANT.test(head['timestamp'])) invalid('HEAD_TIMESTAMP', 'timestamp ISO 8601 attendu');
    if (head['log_id'] !== logId) invalid('HEAD_LOG_ID', 'log_id de tête incohérent');
    if (typeof head['signature'] !== 'string' || Buffer.from(head['signature'], 'base64').length !== 64) invalid('SIGNATURE', 'signature Ed25519 base64 attendue');
    return { tree_size: size as number, root_hash: head['root_hash'] };
  });
  const latest = parsedHeads[parsedHeads.length - 1] as TreeHead;
  for (let index = 1; index < parsedHeads.length; index += 1) {
    if ((parsedHeads[index] as TreeHead).tree_size <= (parsedHeads[index - 1] as TreeHead).tree_size) invalid('TREE_SIZE', 'têtes non croissantes');
  }
  // Une archive ne vaut que pour ce qu'elle couvre : la dernière tête couvre tout l'export.
  if (latest.tree_size !== lastSeq) invalid('COVERAGE', `dernière tête ${latest.tree_size} ≠ écritures ${lastSeq}`);
  return Object.freeze({
    logId,
    entries: entries.length,
    lastSeq,
    treeSize: latest.tree_size,
    entriesSha256: sha256(canonicalize(entries as JsonValue[])),
  });
}

/** Journal d'audit exporté : une ligne JSON par événement, ajout seul. */
export function countAuditRecords(raw: string): number {
  const lines = raw.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) invalid('AUDIT_EMPTY', 'journal d’audit vide');
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      invalid('AUDIT_JSON', 'ligne d’audit illisible');
    }
    if (!isObject(record) || typeof record['event_type'] !== 'string' || record['event_type'] === '') {
      invalid('AUDIT_SHAPE', 'event_type attendu sur chaque ligne');
    }
  }
  return lines.length;
}

function retentionUntil(createdAt: Date): string {
  const until = new Date(Date.UTC(createdAt.getUTCFullYear() + RETENTION_YEARS, createdAt.getUTCMonth(), createdAt.getUTCDate(), createdAt.getUTCHours(), createdAt.getUTCMinutes(), createdAt.getUTCSeconds(), createdAt.getUTCMilliseconds()));
  return until.toISOString();
}

export type CreateArchiveInput = {
  readonly exportPath: string;
  readonly outDirectory: string;
  readonly auditPaths?: readonly string[];
  readonly database?: { readonly sourceUrl: string; readonly wrapper: KeyWrapper; readonly pgBin?: string };
  readonly now?: Date;
};

/** Écrit l'archive (copies octet pour octet + manifeste canonique + empreinte du manifeste). */
export async function createArchive(input: CreateArchiveInput): Promise<{ readonly directory: string; readonly manifest: ArchiveManifest }> {
  const raw = readFileSync(input.exportPath, 'utf8');
  const parsed = parseSignedExport(raw);
  const createdAt = input.now ?? new Date();
  if (!Number.isFinite(createdAt.getTime())) throw new Error('ARCHIVE_ARGUMENTS_INVALID: instant de création');
  const directory = resolve(input.outDirectory, `archive-${createdAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  mkdirSync(resolve(input.outDirectory), { recursive: true });
  mkdirSync(directory, { recursive: false, mode: 0o750 });
  const payloads: ArchivePayload[] = [];
  const ledgerFile = basename(input.exportPath);
  copyFileSync(input.exportPath, join(directory, ledgerFile));
  payloads.push(Object.freeze({ kind: 'ledger-export', file: ledgerFile, sha256: sha256(raw), bytes: Buffer.byteLength(raw), records: parsed.entries }));
  const auditPaths = input.auditPaths ?? [];
  if (auditPaths.length > 1) throw new Error('ARCHIVE_ARGUMENTS_INVALID: un journal d’audit par archive');
  for (const auditPath of auditPaths) {
    const audit = readFileSync(auditPath, 'utf8');
    const file = basename(auditPath);
    if (file === ledgerFile) throw new Error('ARCHIVE_ARGUMENTS_INVALID: noms de charges identiques');
    copyFileSync(auditPath, join(directory, file));
    payloads.push(Object.freeze({ kind: 'audit-export', file, sha256: sha256(audit), bytes: Buffer.byteLength(audit), records: countAuditRecords(audit) }));
  }
  if (input.database !== undefined) {
    const copy = await backupDatabase({ sourceUrl: input.database.sourceUrl, outDirectory: directory, wrapper: input.database.wrapper, ...(input.database.pgBin === undefined ? {} : { pgBin: input.database.pgBin }), now: createdAt });
    const file = basename(copy.file);
    payloads.push(Object.freeze({ kind: 'database-backup', file, sha256: copy.sha256, bytes: statSync(copy.file).size, records: 0 }));
    // L'empreinte détachée déjà écrite par backup.ts est la même : une seule source.
    copyFileSync(`${copy.file}.sha256`, join(directory, `${file}.sha256`));
  }
  const manifest: ArchiveManifest = Object.freeze({
    archive_version: ARCHIVE_VERSION,
    created_at: createdAt.toISOString(),
    log_id: parsed.logId,
    retention: Object.freeze({ years: RETENTION_YEARS, basis: RETENTION_BASIS, until: retentionUntil(createdAt) }),
    ledger: Object.freeze({ entries: parsed.entries, last_seq: parsed.lastSeq, tree_size: parsed.treeSize, entries_sha256: parsed.entriesSha256 }),
    witnesses: Object.freeze({ status: 'UNCONFIGURED', code: WITNESS_UNCONFIGURED }),
    payloads: Object.freeze(payloads),
  });
  const document: JsonValue = {
    archive_version: manifest.archive_version,
    created_at: manifest.created_at,
    log_id: manifest.log_id,
    retention: { years: manifest.retention.years, basis: manifest.retention.basis, until: manifest.retention.until },
    ledger: { entries: manifest.ledger.entries, last_seq: manifest.ledger.last_seq, tree_size: manifest.ledger.tree_size, entries_sha256: manifest.ledger.entries_sha256 },
    witnesses: { status: manifest.witnesses.status, code: manifest.witnesses.code },
    payloads: manifest.payloads.map((payload) => ({ kind: payload.kind, file: payload.file, sha256: payload.sha256, bytes: payload.bytes, records: payload.records })),
  };
  const canonical = canonicalize(document);
  writeFileSync(join(directory, 'manifest.json'), canonical, { mode: 0o444 });
  writeFileSync(join(directory, 'manifest.sha256'), `${sha256(canonical)}  manifest.json\n`, { mode: 0o444 });
  return { directory, manifest };
}

export type ArchiveVerification = {
  readonly status: 'VERIFIED' | 'MISMATCH' | 'NOT_RUN';
  readonly code?: string;
  readonly mismatches: readonly string[];
};

/** Vérifie le contenant (manifeste, empreintes) puis le contenu (vérificateur Rust, clé hors bande). */
export function verifyArchive(input: { readonly directory: string; readonly publicKeyPath: string; readonly verifierBinary: string }): ArchiveVerification {
  const directory = resolve(input.directory);
  let manifestRaw: string;
  try {
    manifestRaw = readFileSync(join(directory, 'manifest.sha256'), 'utf8').split(/\s+/)[0] ?? '';
  } catch {
    return { status: 'MISMATCH', code: 'ARCHIVE_MANIFEST_MISSING', mismatches: ['manifest.sha256 absent'] };
  }
  const manifestBytes = readFileSync(join(directory, 'manifest.json'));
  if (sha256(manifestBytes) !== manifestRaw) return { status: 'MISMATCH', code: 'ARCHIVE_MANIFEST_TAMPERED', mismatches: ['empreinte du manifeste différente'] };
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as ArchiveManifest;
  const mismatches: string[] = [];
  if (manifest.archive_version !== ARCHIVE_VERSION) mismatches.push('version d’archive inconnue');
  if (manifest.witnesses?.status !== 'UNCONFIGURED') mismatches.push('statut de témoin inattendu');
  let ledgerFile: string | undefined;
  for (const payload of manifest.payloads) {
    // Nom simple seulement : aucune traversée de répertoire depuis le manifeste.
    if (basename(payload.file) !== payload.file) {
      mismatches.push(`${payload.file}: chemin non local`);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(directory, payload.file));
    } catch {
      mismatches.push(`${payload.file}: absent`);
      continue;
    }
    if (sha256(bytes) !== payload.sha256) mismatches.push(`${payload.file}: empreinte différente`);
    if (payload.kind === 'ledger-export') ledgerFile = payload.file;
  }
  if (mismatches.length > 0) return { status: 'MISMATCH', code: 'ARCHIVE_TAMPERED', mismatches };
  if (ledgerFile === undefined) return { status: 'MISMATCH', code: 'ARCHIVE_LEDGER_MISSING', mismatches: ['export du grand livre absent'] };
  const outcome = runVerifierBinary(input.verifierBinary, join(directory, ledgerFile), input.publicKeyPath);
  if (outcome.kind === 'VERIFIED') return { status: 'VERIFIED', mismatches: [] };
  if (outcome.kind === 'NOT_RUN') return { status: 'NOT_RUN', code: 'VERIFIER_NOT_RUN', mismatches: [] };
  return { status: 'MISMATCH', code: outcome.code, mismatches: ['vérificateur indépendant : divergence'] };
}

/**
 * Témoins d'ancrage : interface fermée (D6). Aucun faux témoin, aucune archive
 * déclarée ancrée. Le code est celui qui sera servi par l'interface HTTP quand
 * un témoin sera contractualisé (503).
 */
export function requireWitness(): never {
  throw new Error(`${WITNESS_UNCONFIGURED}: aucun témoin d’ancrage configuré (D6)`);
}

/** Restauration vérifiée de la copie de base contenue dans l'archive, base cible vide. */
export async function restoreArchiveDatabase(input: { readonly directory: string; readonly targetUrl: string; readonly wrapper: KeyWrapper; readonly pgBin?: string }): Promise<{ readonly status: 'VERIFIED' | 'MISMATCH'; readonly tables: number; readonly rows: number; readonly mismatches: readonly string[] }> {
  const manifest = JSON.parse(readFileSync(join(resolve(input.directory), 'manifest.json'), 'utf8')) as ArchiveManifest;
  const backup = manifest.payloads.find((payload) => payload.kind === 'database-backup');
  if (backup === undefined) throw new Error('ARCHIVE_BACKUP_MISSING: aucune copie de base dans l’archive');
  const report = await restoreBackup({ file: join(resolve(input.directory), backup.file), targetUrl: input.targetUrl, wrapper: input.wrapper, ...(input.pgBin === undefined ? {} : { pgBin: input.pgBin }) });
  return { status: report.status === 'VERIFIED' ? 'VERIFIED' : 'MISMATCH', tables: report.tables, rows: report.rows, mismatches: report.mismatches };
}

type ArchiveCommand = 'create' | 'verify' | 'restore' | 'witness';

function parseOptions(args: readonly string[]): { readonly command: ArchiveCommand; readonly options: ReadonlyMap<string, string> } {
  const [command, ...rest] = args.filter((arg) => arg !== '--');
  if (command !== 'create' && command !== 'verify' && command !== 'restore' && command !== 'witness') throw new Error('ARCHIVE_ARGUMENTS_INVALID: commande');
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (name === undefined || value === undefined || !name.startsWith('--') || options.has(name)) throw new Error('ARCHIVE_ARGUMENTS_INVALID: options');
    options.set(name, value);
  }
  return { command, options };
}

function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value === '') throw new Error(`ARCHIVE_ARGUMENTS_INVALID: ${name} requis`);
  return value;
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const { command, options } = parseOptions(argv);
    if (command === 'witness') {
      requireWitness();
    }
    if (command === 'create') {
      const audit = options.get('--audit');
      const databaseUrl = options.get('--database-url');
      const pgBin = options.get('--pg-bin');
      const result = await createArchive({
        exportPath: required(options, '--export'),
        outDirectory: required(options, '--out'),
        ...(audit === undefined ? {} : { auditPaths: [audit] }),
        ...(databaseUrl === undefined ? {} : { database: { sourceUrl: databaseUrl, wrapper: keyWrapperFromEnv(process.env), ...(pgBin === undefined ? {} : { pgBin }) } }),
      });
      process.stdout.write(`${JSON.stringify({ status: 'DONE', directory: result.directory, manifest: result.manifest })}\n`);
      return 0;
    }
    if (command === 'verify') {
      const result = verifyArchive({ directory: required(options, '--archive'), publicKeyPath: required(options, '--public-key'), verifierBinary: required(options, '--verifier') });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return result.status === 'VERIFIED' ? 0 : result.status === 'MISMATCH' ? 1 : 2;
    }
    const pgBin = options.get('--pg-bin');
    const result = await restoreArchiveDatabase({ directory: required(options, '--archive'), targetUrl: required(options, '--target-url'), wrapper: keyWrapperFromEnv(process.env), ...(pgBin === undefined ? {} : { pgBin }) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === 'VERIFIED' ? 0 : 1;
  } catch (error) {
    const code = error instanceof Error ? (error.message.split(/[: ]/)[0] ?? 'ARCHIVE_FAILED') : 'ARCHIVE_FAILED';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 3;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
