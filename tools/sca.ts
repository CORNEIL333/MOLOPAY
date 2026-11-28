import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

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
