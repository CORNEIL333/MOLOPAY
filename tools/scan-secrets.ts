import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

export type SecretFinding = {
  file: string;
  line: number;
  rule: string;
};

type Rule = {
  name: string;
  pattern: RegExp;
  generic?: boolean;
  skipPaths?: readonly string[];
};

const RULES: readonly Rule[] = [
  {
    name: 'PRIVATE_KEY_BLOCK',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  { name: 'AWS_ACCESS_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GITHUB_TOKEN', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'SLACK_TOKEN', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'GOOGLE_API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'STRIPE_SECRET_KEY', pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/ },
  {
    name: 'GENERIC_ASSIGNMENT',
    pattern:
      /(?:api[_-]?key|secret|password|passwd|token|private[_-]?key)\s*[:=]\s*['"]([A-Za-z0-9_\-./+=]{20,})['"]/i,
    generic: true,
    skipPaths: ['pnpm-lock.yaml', '.env.example'],
  },
];

const SCANNED_EXTENSIONS =
  /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|toml|ini|conf|properties|env|sql|md|sh|ps1|go|txt)$/i;

export function findSecrets(file: string, content: string): SecretFinding[] {
  const normalized = file.replaceAll('\\', '/');
  if (
    normalized === '.env' ||
    normalized.endsWith('/.env') ||
    /(?:^|\/)\.env\.(?!example$)[A-Za-z0-9_.-]+$/.test(normalized)
  ) {
    return [{ file: normalized, line: 1, rule: 'ENV_FILE_TRACKED' }];
  }

  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (const rule of RULES) {
    if (
      rule.generic === true &&
      (rule.skipPaths ?? []).some((suffix) => normalized.endsWith(suffix))
    ) {
      continue;
    }
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        findings.push({ file: normalized, line: index + 1, rule: rule.name });
      }
    });
  }
  return findings;
}

function listCandidateFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer' },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter((file) => file.length > 0)
    .filter(
      (file) =>
        SCANNED_EXTENSIONS.test(file) ||
        /(?:^|\/)\.env(?:\.|$)/.test(file),
    );
}

export function scanRepository(root = process.cwd()): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const file of listCandidateFiles()) {
    const fullPath = path.join(root, file);
    let size: number;
    try {
      size = statSync(fullPath).size;
    } catch {
      continue;
    }
    if (size > 1_000_000) {
      continue;
    }
    const content = readFileSync(fullPath, 'utf8');
    if (content.includes('\0')) {
      continue;
    }
    findings.push(...findSecrets(file, content));
  }
  return findings;
}

function main(): void {
  const findings = scanRepository();
  if (findings.length === 0) {
    process.stdout.write('Secret scan: OK\n');
    return;
  }
  for (const finding of findings) {
    process.stderr.write(
      `SECRET_SUSPECTED ${finding.rule} ${finding.file}:${finding.line}\n`,
    );
  }
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write(
      `SECRET_SCAN_FAILED ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  }
}
