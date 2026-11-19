import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PG_POOL, type Database } from './http/database';

/** Au-delà, la sonde de disponibilité échoue au lieu d'attendre indéfiniment. */
export const READINESS_TIMEOUT_MS = 2_000;

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('READINESS_TIMEOUT')), milliseconds);
  });
  return Promise.race([operation, expiry]).finally(() => clearTimeout(timer));
}

/**
 * Vivacité : le processus répond, sans dépendre de la base (un redémarrage ne
 * répare pas une base indisponible). Disponibilité : la base répond à une
 * requête triviale dans un délai borné ; le détail de l'échec n'est jamais
 * exposé (NF-REL-001).
 */
@Controller('health')
export class HealthController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get()
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(): Promise<{ status: 'ready' }> {
    try {
      await withTimeout(this.database.pool.query('SELECT 1'), READINESS_TIMEOUT_MS);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
