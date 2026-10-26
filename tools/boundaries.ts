import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

export type BoundaryViolation = {
  code:
    | 'MODULE_BOUNDARY_VIOLATION'
    | 'PACKAGE_BOUNDARY_VIOLATION'
    | 'SIMULATION_FORBIDDEN'
    | 'DB_SCHEMA_IMPORT_FORBIDDEN';
  source: string;
  specifier: string;
};

const MODULE_DEPS: Readonly<Record<string, readonly string[]>> = {
  identity: ['audit'],
  kyc: ['identity', 'audit'],
  catalog: ['audit'],
  agreements: ['catalog', 'ledger', 'audit'],
  payments: ['ledger', 'audit'],
  ledger: ['audit'],
  settlement: ['agreements', 'ledger', 'audit'],
  lending: ['agreements', 'ledger', 'audit'],
  disputes: ['agreements', 'audit'],
  risk: [],
  reconciliation: ['ledger', 'payments'],
  notifications: [],
  audit: [],
  admin: ['audit'],
};

const BANNED_MODULES = new Set([
  'pg-mem',
  'sqlite3',
  'better-sqlite3',
  'msw',
  'nock',
  'mockttp',
]);

const WORKSPACE_TARGETS: Readonly<Record<string, string>> = {
  '@achat/money': 'packages/money/src/index.ts',
  '@achat/contracts': 'packages/contracts/src/index.ts',
  '@achat/chain': 'packages/chain/src/index.ts',
  '@achat/api': 'apps/api/src/main.ts',
};

function normalizeRepoPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//, '');
}

function resolveSpecifier(sourcePath: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return normalizeRepoPath(
      path.posix.join(path.posix.dirname(sourcePath), specifier),
    );
  }
  return WORKSPACE_TARGETS[specifier] ?? null;
}

function moduleOf(repoPath: string): string | null {
  const match = /^apps\/api\/src\/modules\/([^/]+)\//.exec(repoPath);
  return match?.[1] ?? null;
}

export function evaluateImport(input: {
  sourcePath: string;
  specifier: string;
}): BoundaryViolation | null {
  const source = normalizeRepoPath(input.sourcePath);
  const { specifier } = input;

  if (BANNED_MODULES.has(specifier)) {
    return { code: 'SIMULATION_FORBIDDEN', source, specifier };
  }

  const resolved = resolveSpecifier(source, specifier);
  if (resolved === null) {
    return null;
  }

  if (
    (source.startsWith('apps/') || source.startsWith('packages/')) &&
    resolved.startsWith('db/')
  ) {
    return { code: 'DB_SCHEMA_IMPORT_FORBIDDEN', source, specifier };
  }

  if (source.startsWith('packages/money/')) {
    if (!resolved.startsWith('packages/money/')) {
      return { code: 'PACKAGE_BOUNDARY_VIOLATION', source, specifier };
    }
    return null;
  }

  if (
    source.startsWith('packages/contracts/') &&
    resolved.startsWith('apps/')
  ) {
    return { code: 'PACKAGE_BOUNDARY_VIOLATION', source, specifier };
  }

  if (source.startsWith('packages/chain/')) {
    if (!resolved.startsWith('packages/chain/')) {
      return { code: 'PACKAGE_BOUNDARY_VIOLATION', source, specifier };
    }
    return null;
  }

  const sourceModule = moduleOf(source);
  const targetModule = moduleOf(resolved);
  if (
    sourceModule !== null &&
    targetModule !== null &&
    sourceModule !== targetModule &&
    !(MODULE_DEPS[sourceModule] ?? []).includes(targetModule)
  ) {
    return { code: 'MODULE_BOUNDARY_VIOLATION', source, specifier };
  }

  return null;
}

const IMPORT_PATTERN =
  /(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

export function extractSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier !== undefined) {
      specifiers.add(specifier);
    }
  }
  return [...specifiers];
}

function listSourceFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file))
    .filter(
      (file) =>
        file.startsWith('apps/') ||
        file.startsWith('packages/') ||
        file.startsWith('tools/') ||
        file.startsWith('tests/'),
    );
}

export function checkRepository(root = process.cwd()): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const file of listSourceFiles()) {
    const content = readFileSync(path.join(root, file), 'utf8');
    for (const specifier of extractSpecifiers(content)) {
      const violation = evaluateImport({ sourcePath: file, specifier });
      if (violation !== null) {
        violations.push(violation);
      }
    }
  }
  return violations;
}

function main(): void {
  const violations = checkRepository();
  if (violations.length === 0) {
    process.stdout.write('Module boundaries: OK\n');
    return;
  }
  for (const violation of violations) {
    process.stderr.write(
      `${violation.code} ${violation.source} -> ${violation.specifier}\n`,
    );
  }
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write(
      `BOUNDARY_CHECK_FAILED ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
