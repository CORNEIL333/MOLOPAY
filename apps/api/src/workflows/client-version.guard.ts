import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertSupportedClient, CLIENT_VERSION_SETTING_KEY, parseMinimumVersions, type MinimumVersions } from '../modules/identity/client-version';

const CACHE_MS = 60_000;

/**
 * SEC-MOB-005 : refuse (426) une application en dessous de la version
 * minimale publiée. Le minimum est relu au plus toutes les 60 secondes.
 */
@Injectable()
export class ClientVersionGuard implements CanActivate {
  private cached: { readonly at: number; readonly value: MinimumVersions } | null = null;

  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const header = request.headers['x-client-version'];
    if (header === undefined) return true;
    assertSupportedClient(header, await this.minimums());
    return true;
  }

  private async minimums(): Promise<MinimumVersions> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < CACHE_MS) return this.cached.value;
    const value = await withTransaction({ ...this.database, role: 'app_ro' }, async (client) => parseMinimumVersions(
      (await client.query<{ value: unknown }>('SELECT value FROM admin.setting_version WHERE key = $1 ORDER BY version DESC LIMIT 1', [CLIENT_VERSION_SETTING_KEY])).rows[0]?.value,
    ));
    this.cached = { at: now, value };
    return value;
  }
}
