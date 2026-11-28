import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Aucun hôte, nom de base ou URL fourni par l'appelant n'est accepté. */
export function localPostgresOptions(args: readonly string[]): {
  mode: 'db' | 'ci'; host: '127.0.0.1'; database: 'molopay_test';
} {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== 'db' && args[0] !== 'ci')) {
    throw new Error('LOCAL_DB_MODE_INVALID');
  }
  return { mode: args[0] === 'ci' ? 'ci' : 'db', host: '127.0.0.1', database: 'molopay_test' };
}

async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('LOCAL_DB_PORT_UNAVAILABLE'));
        return;
      }
      server.close((error) => error ? reject(error) : accept(address.port));
    });
  });
}

export function localDatabaseEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('PG') || ['DATABASE_URL', 'ALLOW_REMOTE_TEST_DB'].includes(key.toUpperCase())) delete env[key];
  }
  return env;
}

export async function runLocalPostgres(args: readonly string[]): Promise<number> {
  const options = localPostgresOptions(args);
  const binDir = process.env['POSTGRES_BIN'] ?? 'C:/Program Files/PostgreSQL/16/bin';
  const executable = (name: string): string => join(binDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  for (const name of ['initdb', 'pg_ctl', 'createdb']) {
    if (!existsSync(executable(name))) throw new Error(`LOCAL_DB_BINARY_MISSING: ${name}`);
  }
  const tsx = resolve('node_modules/tsx/dist/cli.mjs');
  const vitest = resolve('node_modules/vitest/vitest.mjs');
  if (!existsSync(tsx) || !existsSync(vitest)) throw new Error('LOCAL_DB_DEPENDENCIES_MISSING');
  // Environnement enfant isolé : aucune connexion ni option PostgreSQL héritée.
  const env = localDatabaseEnvironment(process.env);
  const port = await freePort();
  const root = mkdtempSync(join(tmpdir(), 'molopay-postgres-'));
  const data = join(root, 'data');
  const log = join(root, 'postgres.log');
  const run = (file: string, parameters: readonly string[]): number => {
    const result = spawnSync(file, [...parameters], { env, stdio: 'inherit', windowsHide: true });
    if (result.error !== undefined) throw result.error;
    return result.status ?? 1;
  };
  const checked = (file: string, parameters: readonly string[]): void => {
    if (run(file, parameters) !== 0) throw new Error('LOCAL_DB_COMMAND_FAILED');
  };
  process.stdout.write(`Grappe jetable : ${root}\n`);
  checked(executable('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C']);
  let startAttempted = false;
  let resultCode = 1;
  let failure: unknown;
  let stopFailed = false;
  try {
    // Trust est limité à la boucle locale ; aucune écoute sur une interface externe.
    startAttempted = true;
    checked(executable('pg_ctl'), ['-D', data, '-l', log, '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    checked(executable('createdb'), ['-h', options.host, '-p', String(port), '-U', 'postgres', options.database]);
    env['DATABASE_URL'] = `postgres://postgres@127.0.0.1:${port}/${options.database}`;
    resultCode = options.mode === 'ci'
      ? run(process.execPath, [tsx, 'tools/ci-local.ts'])
      : run(process.execPath, [vitest, 'run', '--config', 'vitest.db.config.ts']);
  } catch (error) {
    failure = error;
  } finally {
    if (startAttempted) {
      try {
        stopFailed = run(executable('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']) !== 0;
      } catch {
        stopFailed = true;
      }
    }
    // Conservation du dossier pour diagnostic ; aucune suppression récursive.
    process.stdout.write(`Diagnostic conservé : ${root}\n`);
  }
  if (failure !== undefined) {
    if (stopFailed) process.stderr.write('LOCAL_DB_STOP_FAILED: vérifier manuellement la grappe temporaire\n');
    throw new Error('LOCAL_DB_COMMAND_FAILED', { cause: failure });
  }
  if (stopFailed) throw new Error('LOCAL_DB_STOP_FAILED: arrêt manuel requis');
  return resultCode;
}

if (require.main === module) {
  runLocalPostgres(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'LOCAL_DB_FAILED'}\n`);
    process.exitCode = 1;
  });
}
