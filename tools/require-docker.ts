import { spawnSync } from 'node:child_process';

const configured = process.env['DATABASE_URL']?.trim();
if (configured !== undefined && configured !== '') {
  process.stdout.write(
    'DATABASE_URL fourni : base PostgreSQL existante, Testcontainers ignoré\n',
  );
  process.exit(0);
}

const result = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8',
});

if (result.error !== undefined || result.status !== 0) {
  process.stderr.write(
    'DOCKER_UNAVAILABLE: les tests PostgreSQL exigent Docker (Testcontainers) ' +
      'ou DATABASE_URL vers une base jetable. Aucun test base n’a été exécuté. ' +
      'Voir docs/journal/DECISIONS_EN_ATTENTE.md (D2).\n',
  );
  process.exit(2);
}

process.stdout.write(`Docker ${result.stdout.trim()} disponible\n`);
