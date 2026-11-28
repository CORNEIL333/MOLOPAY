import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * `pnpm audit` par le point d'entrée JavaScript de pnpm, jamais par le shim du
 * PATH : sous Windows, le shim global est un script sans extension que
 * `spawnSync` (même avec shell) ne sait pas lancer. Ordre : `npm_execpath`
 * (posé par pnpm), puis `pnpm.mjs` à côté des binaires du PATH, puis le shim.
 */
function pnpmCli(): string | null {
  const fromEnv = process.env['npm_execpath'];
  if (fromEnv !== undefined && /pnpm(\.c?js|\.mjs)$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const directories = (process.env['PATH'] ?? '').split(delimiter).filter((directory) => directory !== '');
  const candidates = directories.flatMap((directory) => [
    join(directory, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    join(directory, 'pnpm.mjs'),
  ]);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const cli = pnpmCli();
const args = ['audit', '--prod', '--audit-level=high'];
const result =
  cli === null
    ? spawnSync('pnpm', args, { encoding: 'utf8', shell: process.platform === 'win32' })
    : spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

if (result.error !== undefined) {
  process.stderr.write(`SCA_FAILED ${result.error.message}\n`);
  process.exit(2);
}

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
if (stdout.length > 0) {
  process.stdout.write(stdout);
}
if (stderr.length > 0) {
  process.stderr.write(stderr);
}

if (result.status !== 0) {
  process.stderr.write(
    `SCA_FAILED exit=${String(result.status)} (vulnérabilité haute/critique ou registre inaccessible)\n`,
  );
  process.exit(result.status ?? 2);
}

process.stdout.write('SCA: OK\n');
