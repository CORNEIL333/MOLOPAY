import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';
import { parseVerifierOutcome, recordIntegrityDivergence, type VerifierOutcome } from '../apps/api/src/modules/settlement/integrity-divergence.store';

/**
 * INT-VER-002 : contrôle nocturne. Lance le vérificateur indépendant (Rust) sur
 * l'export et la clé publique fournis hors bande ; sur divergence, l'enregistre
 * par le rôle `integrity_reporter` (la base gèle aussitôt les flux sortants,
 * SEC-INC-003) et termine en code 1 (alerte critique pour l'ordonnanceur).
 * Vérification impossible : code 2, sans gel. La planification nocturne et la
 * production de l'export signé relèvent de l'exploitation (Q7) et du lot 23.
 */
export type NightlyReport = { readonly status: 'VERIFIED' | 'DIVERGENCE' | 'NOT_RUN'; readonly code?: string; readonly divergenceId?: string };

export function nightlyOptions(args: readonly string[]): { readonly exportPath: string; readonly publicKeyPath: string } {
  if (args.length !== 4 || args[0] !== '--export' || args[2] !== '--public-key') throw new Error('NIGHTLY_ARGUMENTS_INVALID');
  const [, exportPath, , publicKeyPath] = args;
  if (exportPath === undefined || publicKeyPath === undefined || exportPath === '' || publicKeyPath === '') throw new Error('NIGHTLY_ARGUMENTS_INVALID');
  return { exportPath, publicKeyPath };
}

/** Binaire absent ou injoignable : `spawnSync` rend une erreur, donc « non exécuté ». */
export function runVerifierBinary(binary: string, exportPath: string, publicKeyPath: string): VerifierOutcome {
  const result = spawnSync(binary, ['-export', exportPath, '-public-key', publicKeyPath], { encoding: 'utf8', timeout: 30 * 60_000 });
  return parseVerifierOutcome(result.error === undefined ? result.status : null, result.stderr ?? '');
}

/** Rapporte l'issue ; seule une divergence écrit en base (une ligne, ajout seul). */
export async function reportOutcome(outcome: VerifierOutcome, record: (code: string) => Promise<string>): Promise<NightlyReport> {
  if (outcome.kind === 'VERIFIED') return { status: 'VERIFIED' };
  if (outcome.kind === 'NOT_RUN') return { status: 'NOT_RUN' };
  const divergenceId = await record(outcome.code);
  return { status: 'DIVERGENCE', code: outcome.code, divergenceId };
}

export function exitCodeFor(report: NightlyReport): number {
  return report.status === 'VERIFIED' ? 0 : report.status === 'DIVERGENCE' ? 1 : 2;
}

async function recordWithReporterRole(code: string): Promise<string> {
  const raw = process.env['DATABASE_URL'];
  if (raw === undefined || raw === '') throw new Error('NIGHTLY_DATABASE_MISSING');
  // Rôle dédié : enregistrer une divergence, rien d'autre.
  const client = new Client({ connectionString: raw, options: '-c role=integrity_reporter', application_name: 'molopay-nightly-verify' });
  await client.connect();
  try {
    return await recordIntegrityDivergence(client, code);
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  let options: ReturnType<typeof nightlyOptions>;
  try {
    options = nightlyOptions(process.argv.slice(2));
  } catch {
    process.stdout.write('{"severity":"CRITICAL","status":"NOT_RUN","code":"NIGHTLY_ARGUMENTS_INVALID"}\n');
    return 2;
  }
  const binary = path.join('tools', 'verifier', 'target', 'release', process.platform === 'win32' ? 'verifier.exe' : 'verifier');
  const outcome = runVerifierBinary(binary, options.exportPath, options.publicKeyPath);
  try {
    const report = await reportOutcome(outcome, recordWithReporterRole);
    process.stdout.write(`${JSON.stringify({ severity: report.status === 'VERIFIED' ? 'INFO' : 'CRITICAL', ...report })}\n`);
    return exitCodeFor(report);
  } catch {
    // Divergence constatée mais non enregistrée (base injoignable) : alerte critique quand même.
    process.stdout.write(`${JSON.stringify({ severity: 'CRITICAL', status: 'DIVERGENCE', code: outcome.kind === 'DIVERGENCE' ? outcome.code : 'VERIFIER_DIVERGENCE', recorded: false })}\n`);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    process.stdout.write('{"severity":"CRITICAL","status":"NOT_RUN","code":"NIGHTLY_UNAVAILABLE"}\n');
    process.exitCode = 2;
  });
}
