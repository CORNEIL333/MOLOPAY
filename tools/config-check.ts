import { capabilityReport } from '../apps/api/src/config/production-config';

/**
 * Préparation production : `pnpm config:check` affiche, pour l'environnement
 * courant, l'état de chaque capacité de l'API (configurée ou fermée), sans
 * jamais afficher une valeur. Code 1 si une configuration présente est
 * invalide (l'API refuserait de démarrer).
 */
const report = capabilityReport(process.env);
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exitCode = report.status === 'OK' ? 0 : 1;
