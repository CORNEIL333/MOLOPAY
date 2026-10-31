import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Rejoue en local les contrôles de `.github/workflows/ci.yml` quand les
 * exécuteurs GitHub ne sont pas disponibles (D30). N'appelle ni pnpm ni le
 * réseau : uniquement les binaires de node_modules. Les tests base exigent
 * DATABASE_URL vers une base locale jetable (garde de tests/db/harness.ts).
 * Toute étape en échec rend le code de sortie non nul ; rien n'est sauté
 * silencieusement.
 */

type Step = {
  readonly job: string;
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
};

const root = process.cwd();
const binDir = path.join(root, 'node_modules', '.bin');

function bin(name: string): string {
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  return path.join(binDir, `${name}${suffix}`);
}

const STEPS: readonly Step[] = [
  { job: 'quality', label: 'eslint', bin: 'eslint', args: ['.'] },
  { job: 'quality', label: 'frontières de modules', bin: 'tsx', args: ['tools/boundaries.ts'] },
  { job: 'quality', label: 'types (api)', bin: 'tsc', args: ['-p', 'tsconfig.json'] },
  { job: 'quality', label: 'types (ui)', bin: 'tsc', args: ['-p', 'packages/ui/tsconfig.json'] },
  { job: 'quality', label: 'types (web)', bin: 'tsc', args: ['-p', 'apps/web-client/tsconfig.json'] },
  { job: 'quality', label: 'tests unitaires', bin: 'vitest', args: ['run', '--config', 'vitest.config.ts'] },
  { job: 'quality', label: 'contrat OpenAPI', bin: 'tsx', args: ['tools/check-openapi.ts'] },
  { job: 'quality', label: 'secrets', bin: 'tsx', args: ['tools/scan-secrets.ts'] },
  { job: 'quality', label: 'SCA', bin: 'tsx', args: ['tools/sca.ts'] },
  { job: 'db', label: 'tests base', bin: 'vitest', args: ['run', '--config', 'vitest.db.config.ts'] },
  { job: 'attack', label: 'suites d’attaque', bin: 'vitest', args: ['run', '--config', 'vitest.attack.config.ts'] },
  { job: 'e2e', label: 'bout en bout', bin: 'vitest', args: ['run', '--config', 'vitest.e2e.config.ts'] },
];

const only = new Set(process.argv.slice(2));
const results: { step: Step; ok: boolean; seconds: number }[] = [];

if (only.size === 0 || only.has('db')) {
  const url = process.env['DATABASE_URL']?.trim();
  if (url === undefined || url === '') {
    process.stderr.write(
      'CI_LOCAL_DB_MISSING: DATABASE_URL doit viser une base PostgreSQL locale jetable ' +
        '(ex. postgres://postgres@localhost:54329/achat_test).\n',
    );
    process.exit(2);
  }
}

for (const step of STEPS) {
  if (only.size > 0 && !only.has(step.job)) {
    continue;
  }
  const executable = bin(step.bin);
  if (!existsSync(executable)) {
    process.stderr.write(`CI_LOCAL_TOOL_MISSING: ${executable}\n`);
    process.exit(2);
  }
  process.stdout.write(`\n▶ [${step.job}] ${step.label}\n`);
  const started = Date.now();
  const run = spawnSync(executable, [...step.args], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const ok = run.error === undefined && run.status === 0;
  results.push({ step, ok, seconds: Math.round((Date.now() - started) / 1000) });
}

process.stdout.write('\nRésumé CI locale\n');
for (const { step, ok, seconds } of results) {
  process.stdout.write(`${ok ? 'OK   ' : 'ÉCHEC'} [${step.job}] ${step.label} (${seconds} s)\n`);
}
const failed = results.filter((result) => !result.ok).length;
process.stdout.write(failed === 0 ? 'CI locale : OK\n' : `CI locale : ${failed} étape(s) en échec\n`);
process.exit(failed === 0 ? 0 : 1);
