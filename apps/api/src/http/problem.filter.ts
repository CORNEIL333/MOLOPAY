import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import type { HttpResponse } from './express-types';
import { correlationIdFromHeader } from '../observability/correlation';
import { emitLog, LOG_SINK, type LogSink } from '../observability/log';
import { toProblem, type Problem } from './problem';

function fromHttpException(error: HttpException): Problem {
  const status = error.getStatus();
  if (status === 404) {
    return { type: 'urn:achat:problem:route-not-found', title: 'Ressource introuvable', status: 404, code: 'ROUTE_NOT_FOUND' };
  }
  return { type: 'urn:achat:problem:request-invalid', title: 'Requête invalide', status: 400, code: 'REQUEST_INVALID' };
}

type FilterRequest = {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly correlationId?: string;
};

/** Nom de classe seul, assaini : jamais le message ni la pile. */
function errorNameOf(error: unknown): string {
  const raw = error instanceof Error ? error.name : '';
  const cleaned = raw.replace(/[^A-Za-z0-9_.$-]/g, '').slice(0, 80);
  return cleaned === '' ? 'Unknown' : cleaned;
}

/**
 * Toute erreur sort en `application/problem+json` (RFC 9457) avec un code
 * métier stable. Les erreurs internes (5xx) sont journalisées avec la
 * corrélation, sans message ni pile ; les refus métier 4xx ne le sont pas.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  public constructor(@Inject(LOG_SINK) private readonly sink: LogSink | null) {}

  public catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponse>();
    const request = http.getRequest<FilterRequest | undefined>();
    const body = error instanceof HttpException ? fromHttpException(error) : toProblem(error);

    if (body.status >= 500) {
      const correlationId = correlationIdFromHeader(
        typeof request?.correlationId === 'string' ? request.correlationId : undefined,
      );
      const path = request?.originalUrl ?? request?.url;
      emitLog(this.sink, {
        level: 'error',
        event: 'http_error',
        correlationId,
        status: body.status,
        code: body.code,
        errorName: errorNameOf(error),
        ...(typeof request?.method === 'string' ? { method: request.method } : {}),
        ...(typeof path === 'string' ? { path } : {}),
      });
    }

    response.status(body.status).type('application/problem+json').json(body);
  }
}
