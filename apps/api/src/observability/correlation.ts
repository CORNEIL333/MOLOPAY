import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { emitLog, LOG_SINK, type LogSink } from './log';

/** En-tête de corrélation, propagé de bout en bout (NF-OBS-001). */
export const CORRELATION_HEADER = 'x-correlation-id';

/** Identifiant acceptable : court, imprimable, sans contrôle ni espace. */
const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Reprend l'identifiant fourni s'il est conforme, sinon en génère un. Un
 * en-tête forgé ne peut donc ni injecter de ligne ni allonger le journal.
 */
export function correlationIdFromHeader(value: string | undefined): string {
  return typeof value === 'string' && CORRELATION_PATTERN.test(value) ? value : randomUUID();
}

function headerValue(raw: string | readonly string[] | undefined): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

type CorrelatedRequest = {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly originalUrl?: string;
  readonly url?: string;
  correlationId?: string;
};

type CorrelatedResponse = {
  readonly statusCode?: number;
  setHeader(name: string, value: string): void;
  on(event: 'finish', listener: () => void): void;
};

/**
 * Pose la corrélation sur la requête et la réponse, puis journalise une ligne
 * par requête servie. Les paramètres de requête ne sont jamais recopiés.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  public constructor(@Inject(LOG_SINK) private readonly sink: LogSink | null) {}

  public use(request: CorrelatedRequest, response: CorrelatedResponse, next: (error?: unknown) => void): void {
    const correlationId = correlationIdFromHeader(headerValue(request.headers?.[CORRELATION_HEADER]));
    request.correlationId = correlationId;
    response.setHeader(CORRELATION_HEADER, correlationId);

    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const path = request.originalUrl ?? request.url;
      emitLog(this.sink, {
        level: 'info',
        event: 'http_request',
        correlationId,
        ...(typeof request.method === 'string' ? { method: request.method } : {}),
        ...(typeof path === 'string' ? { path } : {}),
        ...(typeof response.statusCode === 'number' ? { status: response.statusCode } : {}),
        durationMs,
      });
    });

    next();
  }
}
