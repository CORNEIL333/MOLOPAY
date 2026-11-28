import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plan du fondateur du 27 novembre, étape 3 (D30, SEC-SDLC-004) : la CI
 * GitHub et sa réplique locale (`pnpm ci:local`) exécutent TOUS les contrôles
 * du dépôt, sur la branche d'intégration active ; chaque action GitHub est
 * épinglée par empreinte de commit (jamais par étiquette mobile).
 */
const ROOT = resolve(__dirname, '..');
const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
const local = readFileSync(resolve(ROOT, 'tools/ci-local.ts'), 'utf8');

describe('CI — couverture, branches, épinglage', () => {
  it('déclenchée sur la branche d’intégration et ses variantes de session', () => {
    expect(ci).toMatch(/branches: \[sprint\/integration, 'sprint\/integration-\*'\]/);
  });

  it('exécute chaque contrôle du dépôt : TypeScript, web, base, attaque, bout en bout, vérificateur Rust, mobile Flutter', () => {
    for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm test:web', 'pnpm openapi:check', 'pnpm security:scan', 'pnpm test:db', 'pnpm test:attack', 'pnpm test:e2e', 'cargo test --locked', 'flutter analyze', 'flutter test']) {
      expect(ci, command).toContain(`run: ${command}`);
    }
  });

  it('chaque action est épinglée par une empreinte de commit de 40 caractères', () => {
    const uses = [...ci.matchAll(/uses: ([^\s#]+)/g)].map((match) => match[1] ?? '');
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use, use).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/);
  });

  it('Flutter : SDK officiel à la version épinglée utilisée en local (3.47.9), sans action tierce', () => {
    expect(ci).toContain('https://github.com/flutter/flutter.git');
    expect(ci).toContain('--branch 3.47.9');
    expect(ci).not.toMatch(/uses: subosito\//);
  });
});

describe('CI locale — mêmes contrôles que la CI GitHub', () => {
  it('chaque projet TypeScript est vérifié (comme pnpm typecheck)', () => {
    for (const project of ['tsconfig.json', 'packages/ui/tsconfig.json', 'apps/web-client/tsconfig.json', 'apps/back-office/tsconfig.json', 'apps/partner-portal/tsconfig.json']) {
      expect(local, project).toContain(`'${project}'`);
    }
  });

  it('tests web, vérificateur Rust et mobile Flutter présents, avec leurs travaux', () => {
    expect(local).toContain("'vitest.web.config.ts'");
    expect(local).toMatch(/job: 'verifier'[^\n]*'cargo'[^\n]*'--locked'/);
    expect(local).toMatch(/job: 'mobile'[^\n]*'flutter'[^\n]*'analyze'/);
    expect(local).toMatch(/job: 'mobile'[^\n]*'flutter'[^\n]*'test'/);
  });
});
