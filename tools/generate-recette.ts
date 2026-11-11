import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';
import { exportLedgerEntries } from '../apps/api/src/modules/ledger/export.store';
import { startTestDatabase } from '../apps/api/test/db/harness';
import { exportDocument, runRealFlowsScenario } from '../apps/api/test/db/real-flows-scenario';

/**
 * Lot 25 / D59 : génère le jeu de données de recette en rejouant les flux
 * réels de l'API sur une base JETABLE (DATABASE_URL locale, ou conteneur de
 * test) — jamais la production (garde de `startTestDatabase`). Écrit l'export
 * signé du grand livre et la clé publique de journal, à vérifier par
 * `pnpm verify:ledger <export> <clé>`. Clé de journal générée à chaque
 * exécution, jamais conservée : aucune donnée personnelle ni secret réel.
 */
async function main(): Promise<void> {
  const outputDir = path.resolve(process.argv[2] ?? path.join('tmp', 'recette'));
  const database = await startTestDatabase();
  const admin = new Client({ connectionString: database.getConnectionUri() });
  await admin.connect();
  try {
    await runRealFlowsScenario(database.getConnectionUri(), admin);
    const entries = await exportLedgerEntries(admin);
    const logKey = generateKeyPairSync('ed25519');
    const raw = logKey.publicKey.export({ type: 'spki', format: 'der' });
    mkdirSync(outputDir, { recursive: true });
    const exportPath = path.join(outputDir, 'ledger-export.json');
    const keyPath = path.join(outputDir, 'ledger-public-key.txt');
    writeFileSync(exportPath, `${JSON.stringify(exportDocument(entries, logKey.privateKey, 'molopay-recette'), null, 2)}\n`);
    writeFileSync(keyPath, `${raw.subarray(raw.length - 32).toString('hex')}\n`);
    process.stdout.write(`RECETTE GENERATED entries=${entries.length} export=${exportPath} public_key=${keyPath}\n`);
  } finally {
    await admin.end();
    await database.stop();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`RECETTE_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
