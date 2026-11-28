import { spawn, spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, mkdtempSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { assertDirectEndpoint, assertSecureDatabaseUrl } from '../apps/api/src/http/database';
import { awsKmsKeyWrapper } from '../apps/api/src/crypto/aws-kms';
import { localKeyWrapper, type KeyWrapper } from '../apps/api/src/crypto/envelope';
import { applicationRoles, assertEmptyTarget, compare, ensureRoles, SCHEMAS, snapshot, type TransferReport } from './transfer-database';

/**
 * N4 (ADR-0004) : notre propre copie quotidienne de la base Neon, chiffrée par
 * nos clés (AWS KMS, clé distincte de celle des données personnelles), à
 * déposer dans une seconde région AWS ; c'est aussi la porte de sortie.
 *
 * Copie : `pg_dump` (format personnalisé, instantané cohérent) lu en flux et
 * chiffré à la volée — aucun clair n'est écrit sur disque. Format : en-tête
 * (clé de données emballée, préfixe de nonce), puis blocs AES-256-GCM d'au
 * plus 1 Mio ; les données authentifiées de chaque bloc lient l'en-tête, le
 * rang du bloc et l'indicateur de dernier bloc : modification, réordonnement,
 * troncature ou mauvaise clé sont refusés (`BACKUP_INTEGRITY_FAILED`).
 *
 * Restauration : déchiffrement complet et vérifié dans un répertoire privé
 * temporaire, puis `pg_restore` en une transaction dans une base VIDE, puis
 * vérification (contenu, déclencheurs, droits, grand livre) ; le clair
 * temporaire est supprimé dans tous les cas.
 */
const MAGIC = Buffer.from('MOLOPAY-BACKUP-v1\n', 'utf8');
const CHUNK = 1024 * 1024;
const TAG = 16;
const FAILED = 'BACKUP_INTEGRITY_FAILED: copie altérée, tronquée ou clé incorrecte';

type Header = { readonly v: 1; readonly keyId: string; readonly wrappedKey: string; readonly noncePrefix: string; readonly chunk: number };

function frameAad(headerDigest: Buffer, index: number, final: boolean): Buffer {
  const tail = Buffer.alloc(5);
  tail.writeUInt32BE(index, 0);
  tail.writeUInt8(final ? 1 : 0, 4);
  return Buffer.concat([headerDigest, tail]);
}

function frameNonce(prefix: Buffer, index: number): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(index, 0);
  return Buffer.concat([prefix, counter]);
}

/** Chiffre un flux vers `outPath` (écrit sous un nom provisoire puis renommé) ; renvoie l'empreinte SHA-256 du chiffré. */
async function sealStream(source: AsyncIterable<Buffer>, outPath: string, wrapper: KeyWrapper): Promise<string> {
  const dataKey = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const header: Header = { v: 1, keyId: wrapper.keyId, wrappedKey: Buffer.from(await wrapper.wrap(dataKey)).toString('base64'), noncePrefix: noncePrefix.toString('base64'), chunk: CHUNK };
  const headerBytes = Buffer.concat([MAGIC, Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')]);
  const headerDigest = createHash('sha256').update(headerBytes).digest();
  const partial = `${outPath}.partial`;
  const fd = openSync(partial, 'wx', 0o600);
  const digest = createHash('sha256');
  const write = (bytes: Buffer): void => {
    writeSync(fd, bytes);
    digest.update(bytes);
  };
  let index = 0;
  const emit = (plain: Buffer, final: boolean): void => {
    const cipher = createCipheriv('aes-256-gcm', dataKey, frameNonce(noncePrefix, index));
    cipher.setAAD(frameAad(headerDigest, index, final));
    const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    const prefix = Buffer.alloc(5);
    prefix.writeUInt32BE(plain.length, 0);
    prefix.writeUInt8(final ? 1 : 0, 4);
    write(Buffer.concat([prefix, sealed]));
    index += 1;
  };
  try {
    write(headerBytes);
    let pending = Buffer.alloc(0);
    for await (const piece of source) {
      pending = Buffer.concat([pending, piece]);
      while (pending.length > CHUNK) {
        emit(pending.subarray(0, CHUNK), false);
        pending = pending.subarray(CHUNK);
      }
    }
    emit(pending, true);
    closeSync(fd);
    renameSync(partial, outPath);
  } catch (error) {
    closeSync(fd);
    rmSync(partial, { force: true });
    throw error;
  } finally {
    dataKey.fill(0);
  }
  return digest.digest('hex');
}

async function* fileChunks(path: string): AsyncGenerator<Buffer> {
  for await (const piece of createReadStream(path, { highWaterMark: CHUNK })) yield piece as Buffer;
}

export async function encryptBackupFile(plainPath: string, outPath: string, wrapper: KeyWrapper): Promise<string> {
  return sealStream(fileChunks(plainPath), outPath, wrapper);
}

/** Déchiffre et vérifie TOUT le fichier ; la sortie n'apparaît sous son nom qu'une fois l'ensemble vérifié. */
export async function decryptBackupFile(sealedPath: string, outPath: string, wrapper: KeyWrapper): Promise<void> {
  const partial = `${outPath}.partial`;
  const fd = openSync(partial, 'wx', 0o600);
  let dataKey: Buffer | null = null;
  try {
    let buffer = Buffer.alloc(0);
    const source = fileChunks(sealedPath)[Symbol.asyncIterator]();
    const need = async (length: number): Promise<boolean> => {
      while (buffer.length < length) {
        const next = await source.next();
        if (next.done === true) return false;
        buffer = Buffer.concat([buffer, next.value]);
      }
      return true;
    };
    if (!(await need(MAGIC.length)) || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(FAILED);
    let newline = buffer.indexOf(0x0a, MAGIC.length);
    while (newline < 0) {
      if (buffer.length > 64 * 1024 || !(await need(buffer.length + 1))) throw new Error(FAILED);
      newline = buffer.indexOf(0x0a, MAGIC.length);
    }
    const headerBytes = buffer.subarray(0, newline + 1);
    const header = JSON.parse(buffer.subarray(MAGIC.length, newline).toString('utf8')) as Partial<Header>;
    if (header.v !== 1 || typeof header.wrappedKey !== 'string' || typeof header.noncePrefix !== 'string' || header.chunk !== CHUNK) throw new Error(FAILED);
    const noncePrefix = Buffer.from(header.noncePrefix, 'base64');
    if (noncePrefix.length !== 8) throw new Error(FAILED);
    dataKey = Buffer.from(await wrapper.unwrap(Buffer.from(header.wrappedKey, 'base64')));
    const headerDigest = createHash('sha256').update(headerBytes).digest();
    buffer = buffer.subarray(newline + 1);
    for (let index = 0; ; index += 1) {
      if (!(await need(5))) throw new Error(FAILED);
      const length = buffer.readUInt32BE(0);
      const final = buffer.readUInt8(4);
      if (length > CHUNK || final > 1) throw new Error(FAILED);
      if (!(await need(5 + length + TAG))) throw new Error(FAILED);
      const sealed = buffer.subarray(5, 5 + length);
      const tag = buffer.subarray(5 + length, 5 + length + TAG);
      const decipher = createDecipheriv('aes-256-gcm', dataKey, frameNonce(noncePrefix, index));
      decipher.setAAD(frameAad(headerDigest, index, final === 1));
      decipher.setAuthTag(tag);
      writeSync(fd, Buffer.concat([decipher.update(sealed), decipher.final()]));
      buffer = buffer.subarray(5 + length + TAG);
      if (final === 1) {
        if (buffer.length > 0 || (await need(1))) throw new Error(FAILED);
        break;
      }
    }
    closeSync(fd);
    renameSync(partial, outPath);
  } catch (error) {
    closeSync(fd);
    rmSync(partial, { force: true });
    if (error instanceof Error && error.message.startsWith('BACKUP_')) throw error;
    throw new Error(FAILED, { cause: error });
  } finally {
    dataKey?.fill(0);
  }
}

function pgEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith('PG')) delete env[key];
  return env;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Copie chiffrée de la base source dans `outDirectory` : `molopay-<instant>.dump.enc` et son empreinte `.sha256`. */
export async function backupDatabase(input: { readonly sourceUrl: string; readonly outDirectory: string; readonly wrapper: KeyWrapper; readonly pgBin?: string; readonly now?: Date }): Promise<{ readonly file: string; readonly sha256: string }> {
  assertSecureDatabaseUrl(input.sourceUrl, process.env);
  // pg_dump (instantané sérialisable) : point d'accès direct exigé.
  assertDirectEndpoint(input.sourceUrl);
  const bin = input.pgBin === undefined ? 'pg_dump' : join(input.pgBin, 'pg_dump');
  const name = `molopay-${stamp(input.now ?? new Date())}.dump.enc`;
  const file = resolve(input.outDirectory, name);
  const child = spawn(bin, ['--format=custom', '--serializable-deferrable', '--no-owner', ...SCHEMAS.flatMap((schema) => ['--schema', schema]), '--dbname', input.sourceUrl], { env: pgEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (piece: Buffer) => { stderr = (stderr + piece.toString('utf8')).slice(-2000); });
  const exited = new Promise<number>((accept) => child.on('close', (code) => accept(code ?? 1)));
  let sha256: string;
  try {
    sha256 = await sealStream(child.stdout as AsyncIterable<Buffer>, file, input.wrapper);
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
  if ((await exited) !== 0) {
    rmSync(file, { force: true });
    // Message d'outil seulement : aucune donnée de ligne.
    throw new Error(`BACKUP_TOOL_FAILED pg_dump: ${stderr.split('\n').slice(0, 3).join(' ')}`);
  }
  writeFileSync(`${file}.sha256`, `${sha256}  ${name}\n`, { mode: 0o644 });
  return { file, sha256 };
}

/** Restauration vérifiée dans une base vide ; comparaison table par table si la source est fournie. */
export async function restoreBackup(input: { readonly file: string; readonly targetUrl: string; readonly wrapper: KeyWrapper; readonly pgBin?: string; readonly sourceUrlForComparison?: string }): Promise<TransferReport> {
  assertSecureDatabaseUrl(input.targetUrl, process.env);
  const roles = applicationRoles();
  await assertEmptyTarget(input.targetUrl);
  await ensureRoles(input.targetUrl, roles);
  const work = mkdtempSync(join(tmpdir(), 'molopay-restore-'));
  try {
    const plain = join(work, 'base.dump');
    await decryptBackupFile(input.file, plain, input.wrapper);
    const bin = input.pgBin === undefined ? 'pg_restore' : join(input.pgBin, 'pg_restore');
    const result = spawnSync(bin, ['--exit-on-error', '--single-transaction', '--no-owner', '--dbname', input.targetUrl, plain], { encoding: 'utf8', env: pgEnv(), maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`BACKUP_TOOL_FAILED pg_restore: ${(result.stderr ?? '').split('\n').slice(0, 3).join(' ')}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const target = await snapshot(input.targetUrl, roles);
  if (input.sourceUrlForComparison !== undefined) return compare(await snapshot(input.sourceUrlForComparison, roles), target);
  const mismatches = target.ledger.unbalanced !== 0 || target.ledger.gaps !== 0 ? ['grand livre : écriture déséquilibrée ou trou de séquence'] : [];
  const rows = [...target.tables.values()].reduce((sum, table) => sum + table.rows, 0);
  return { status: mismatches.length === 0 ? 'VERIFIED' : 'MISMATCH', tables: target.tables.size, rows, mismatches };
}

/** Clé de la copie : AWS KMS (distincte de la clé des données personnelles) ; clé locale hors production seulement. */
export function backupKeyWrapperFromEnv(env: NodeJS.ProcessEnv): KeyWrapper {
  const arn = env['BACKUP_KMS_KEY_ARN']?.trim();
  if (arn !== undefined && arn !== '') {
    if (arn === env['PII_KMS_KEY_ARN']?.trim()) throw new Error('BACKUP_KEY_NOT_DISTINCT: la copie exige sa propre clé KMS');
    return awsKmsKeyWrapper(arn, undefined, 'molopay-backup-dek-v1');
  }
  const local = env['BACKUP_LOCAL_MASTER_KEY']?.trim();
  if (local !== undefined && local !== '') {
    if (env['NODE_ENV'] === 'production') throw new Error('BACKUP_LOCAL_KEY_FORBIDDEN_IN_PRODUCTION');
    if (!/^[0-9a-f]{64}$/.test(local)) throw new Error('BACKUP_KEY_INVALID');
    return localKeyWrapper(Buffer.from(local, 'hex'));
  }
  throw new Error('BACKUP_KEY_MISSING: BACKUP_KMS_KEY_ARN requis');
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv.filter((arg) => arg !== '--');
  try {
    const wrapper = backupKeyWrapperFromEnv(process.env);
    if (command === 'backup' && rest.length === 0) {
      const source = process.env['BACKUP_SOURCE_URL'] ?? '';
      const out = process.env['BACKUP_OUT_DIR'] ?? '';
      if (source === '' || out === '') throw new Error('BACKUP_ARGUMENTS_INVALID');
      const result = await backupDatabase({ sourceUrl: source, outDirectory: out, wrapper, ...(process.env['BACKUP_PG_BIN'] === undefined ? {} : { pgBin: process.env['BACKUP_PG_BIN'] }) });
      process.stdout.write(`${JSON.stringify({ status: 'DONE', file: basename(result.file), sha256: result.sha256 })}\n`);
      return 0;
    }
    if (command === 'restore' && rest.length === 1 && rest[0] !== undefined) {
      const target = process.env['RESTORE_TARGET_URL'] ?? '';
      if (target === '') throw new Error('BACKUP_ARGUMENTS_INVALID');
      const report = await restoreBackup({ file: rest[0], targetUrl: target, wrapper, ...(process.env['BACKUP_PG_BIN'] === undefined ? {} : { pgBin: process.env['BACKUP_PG_BIN'] }) });
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report.status === 'VERIFIED' ? 0 : 1;
    }
    throw new Error('BACKUP_ARGUMENTS_INVALID');
  } catch (error) {
    const code = error instanceof Error ? (error.message.split(/[: ]/)[0] ?? 'BACKUP_FAILED') : 'BACKUP_FAILED';
    process.stdout.write(`${JSON.stringify({ status: 'ERROR', code })}\n`);
    return 2;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
