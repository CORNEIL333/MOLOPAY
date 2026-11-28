import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from '../../apps/api/test/db/harness';
import { buildApi } from '../../tools/build-api';

/**
 * P2 : artefact de production de l'API (`pnpm build:api`). Le fichier
 * construit est réellement lancé avec Node : il démarre et répond, s'arrête
 * proprement sur SIGTERM, et refuse de démarrer sur une configuration de
 * production invalide, sans afficher l'adresse ni le mot de passe.
 */
const ROOT = resolve(__dirname, '../..');
let db: TestDatabase;
let outDir: string;
let artifact: string;

function freePort(): Promise<number> {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address !== null && typeof address === 'object' ? accept(address.port) : reject(new Error('port'))));
    });
  });
}

function launch(env: NodeJS.ProcessEnv): { child: ChildProcess; output: () => string; exit: Promise<number | null> } {
  let output = '';
  const child = spawn(process.execPath, [artifact], { cwd: ROOT, env: { PATH: process.env['PATH'] ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (piece: Buffer) => { output += piece.toString('utf8'); });
  child.stderr?.on('data', (piece: Buffer) => { output += piece.toString('utf8'); });
  const exit = new Promise<number | null>((accept) => child.on('exit', (code) => accept(code)));
  return { child, output: () => output, exit };
}

async function waitForHealth(port: number, deadline: number): Promise<number> {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.status;
    } catch {
      await new Promise((accept) => setTimeout(accept, 200));
    }
  }
  return -1;
}

beforeAll(async () => {
  db = await startTestDatabase();
  mkdirSync(join(ROOT, 'apps', 'api', 'dist'), { recursive: true });
  outDir = mkdtempSync(join(ROOT, 'apps', 'api', 'dist', 'build-test-'));
  artifact = (await buildApi({ outDir })).file;
}, 300_000);

afterAll(async () => {
  rmSync(outDir, { recursive: true, force: true });
  await db.stop();
});

describe('P2 — artefact de production de l’API', () => {
  it('un seul fichier construit, lancé avec Node : il répond sur /health puis s’arrête proprement sur SIGTERM', async () => {
    expect(existsSync(artifact)).toBe(true);
    const port = await freePort();
    const run = launch({ DATABASE_URL: db.getConnectionUri(), DATABASE_ROLE: 'app_rw', PORT: String(port) });
    try {
      expect(await waitForHealth(port, Date.now() + 30_000), run.output()).toBe(200);
      run.child.kill('SIGTERM');
      expect(await run.exit).toBe(0);
    } finally {
      run.child.kill('SIGKILL');
    }
  }, 120_000);

  it('refuse de démarrer (code 1) : base de production sans TLS vérifié ; ni l’adresse ni le mot de passe ne sont affichés', async () => {
    const run = launch({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://molopay_api:mot-de-passe-secret@ep-exemple.eu-central-1.aws.neon.tech/molopay', PORT: String(await freePort()) });
    expect(await run.exit).toBe(1);
    expect(run.output()).toContain('DATABASE_TLS_REQUIRED');
    expect(run.output()).not.toContain('mot-de-passe-secret');
    expect(run.output()).not.toContain('ep-exemple');
  }, 60_000);

  it('refuse de démarrer (code 1) : configuration absente ou invalide, code seul affiché', async () => {
    const missing = launch({ PORT: String(await freePort()) });
    expect(await missing.exit).toBe(1);
    expect(missing.output().trim()).toBe('{"status":"ERROR","code":"CONFIG_MISSING"}');
    const badRp = launch({ DATABASE_URL: db.getConnectionUri(), STAFF_RP_ID: 'molopay.cm', STAFF_RP_ORIGINS: 'http://hote-interne.example', PORT: String(await freePort()) });
    expect(await badRp.exit).toBe(1);
    expect(badRp.output().trim()).toBe('{"status":"ERROR","code":"CONFIG_INVALID"}');
    expect(badRp.output()).not.toContain('hote-interne');
  }, 60_000);
});
