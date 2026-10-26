import { spawnSync } from 'node:child_process';

const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8',
});

if (result.error !== undefined || result.status !== 0) {
  process.stderr.write(
    'DOCKER_UNAVAILABLE: les tests PostgreSQL exigent Docker (Testcontainers). ' +
      'Aucun test base n’a été exécuté. Voir docs/journal/DECISIONS_EN_ATTENTE.md (D2).\n',
  );
  process.exit(2);
}

process.stdout.write(`Docker ${result.stdout.trim()} disponible\n`);
