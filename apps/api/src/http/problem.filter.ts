import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import { problemLocaleFromHeader, type ProblemLocale } from '@achat/contracts';
import type { HttpResponse } from './express-types';
import { correlationIdFromHeader } from '../observability/correlation';
import { emitLog, LOG_SINK, type LogSink } from '../observability/log';
import { problemForStatus, toProblem } from './problem';

type FilterRequest = {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly correlationId?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
};

function acceptLanguage(request: FilterRequest | undefined): string | undefined {
  const value = request?.headers?.['accept-language'];
  return typeof value === 'string' ? value : undefined;
}

/** Nom de classe seul, assaini : jamais le message ni la pile. */
function errorNameOf(error: unknown): string {
  const raw = error instanceof Error ? error.name : '';
  const cleaned = raw.replace(/[^A-Za-z0-9_.$-]/g, '').slice(0, 80);
  return cleaned === '' ? 'Unknown' : cleaned;
}

/**
 * Toute erreur sort en `application/problem+json` (RFC 9457) avec un code
 * métier stable et un titre FR/EN selon `Accept-Language` (français par
 * défaut). Les erreurs internes (5xx) sont journalisées avec la corrélation,
 * sans message ni pile ; les refus métier 4xx ne le sont pas.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  public constructor(@Inject(LOG_SINK) private readonly sink: LogSink | null) {}

  public catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponse>();
    const request = http.getRequest<FilterRequest | undefined>();
    const locale: ProblemLocale = problemLocaleFromHeader(acceptLanguage(request));
    const body = error instanceof HttpException
      ? problemForStatus(error.getStatus(), locale)
      : toProblem(error, locale);

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

    response.setHeader?.('content-language', locale);
    response.status(body.status).type('application/problem+json').json(body);
  }
}
