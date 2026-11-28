import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import type { HttpRequest } from './express-types';

export const ALLOWED_ORIGINS = Symbol('ALLOWED_ORIGINS');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origines autorisées (liste exacte, séparée par des virgules) ; vide = aucune. */
export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env['ALLOWED_ORIGINS'] ?? '';
  return new Set(
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(origin)),
  );
}

/**
 * Défense CSRF des routes à cookie : toute méthode non sûre exige un en-tête
 * Origin présent dans la liste blanche. Refus par défaut.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  public constructor(@Inject(ALLOWED_ORIGINS) private readonly allowed: ReadonlySet<string>) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const origin = request.headers['origin'];
    if (typeof origin !== 'string' || !this.allowed.has(origin)) {
      throw new BusinessError('ORIGIN_FORBIDDEN', 'Origine de la requête non autorisée');
    }
    return true;
  }
}
