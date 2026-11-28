import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const binaryName = process.platform === 'win32' ? 'verifier.exe' : 'verifier';
const releaseDir = path.join('tools', 'verifier', 'target', 'release');
const manifestPath = path.join('tools', 'verifier', 'Cargo.toml');

function findBinary(): string | undefined {
  const candidates = [
    path.join(releaseDir, binaryName),
    path.join('tools', 'verifier', 'bin', binaryName),
    path.join('tools', 'verifier', binaryName),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function buildRelease(): string | undefined {
  process.stderr.write('Vérificateur absent, compilation release en cours…\n');
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', manifestPath],
    { stdio: 'inherit' },
  );
  if (build.error !== undefined) {
    process.stderr.write(
      `VERIFIER_BUILD_FAILED: cargo est introuvable ou inutilisable (${build.error.message}). ` +
        'Aucune vérification n’a été exécutée.\n',
    );
    process.exit(2);
  }
  if (build.status !== 0) {
    process.stderr.write(
      'VERIFIER_BUILD_FAILED: la compilation release a échoué. ' +
        'Aucune vérification n’a été exécutée.\n',
    );
    process.exit(2);
  }
  return findBinary();
}

const binary = findBinary() ?? buildRelease();
if (binary === undefined) {
  process.stderr.write(
    'VERIFIER_NOT_BUILT: binaire release introuvable après compilation. ' +
      'Aucune vérification n’a été exécutée.\n',
  );
  process.exit(2);
}

const exportPath =
  process.argv[2] ?? path.join('tests', 'fixtures', 'ledger-export.json');
const publicKeyPath =
  process.argv[3] ?? path.join('tests', 'fixtures', 'ledger-public-key.txt');
const extraArgs = process.argv.slice(4);

const result = spawnSync(
  binary,
  ['-export', exportPath, '-public-key', publicKeyPath, ...extraArgs],
  { stdio: 'inherit' },
);
if (result.error !== undefined) {
  process.stderr.write(`VERIFIER_FAILED ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
