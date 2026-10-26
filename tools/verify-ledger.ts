import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const binaryName = process.platform === 'win32' ? 'verifier.exe' : 'verifier';
const candidates = [
  path.join('tools', 'verifier', 'bin', binaryName),
  path.join('tools', 'verifier', binaryName),
];
const binary = candidates.find((candidate) => existsSync(candidate));

if (binary === undefined) {
  process.stderr.write(
    'VERIFIER_NOT_BUILT: compiler tools/verifier puis relancer pnpm verify:ledger. ' +
      'Aucune vérification n’a été exécutée.\n',
  );
  process.exit(2);
}

const exportPath = process.argv[2] ?? path.join('tests', 'fixtures', 'ledger-export.json');
const result = spawnSync(binary, ['-export', exportPath], {
  stdio: 'inherit',
});
if (result.error !== undefined) {
  process.stderr.write(`VERIFIER_FAILED ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
