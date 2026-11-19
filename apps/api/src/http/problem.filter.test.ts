import type { ArgumentsHost } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import type { LogSink } from '../observability/log';
import { ProblemFilter } from './problem.filter';

type FakeResponse = {
  statusCode: number;
  contentType: string | undefined;
  body: unknown;
  status(code: number): FakeResponse;
  type(value: string): FakeResponse;
  json(value: unknown): FakeResponse;
  setHeader(name: string, value: string): void;
};

function response(): FakeResponse {
  return {
    statusCode: 0,
    contentType: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    json(value) { this.body = value; return this; },
    setHeader() { /* en-tête posé par le middleware de corrélation */ },
  };
}

function host(res: FakeResponse, request: Record<string, unknown>): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

function capture(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { write: (line) => { lines.push(line); } }, lines };
}

describe('NF-OBS-001 · journalisation des erreurs HTTP', () => {
  it('NF-OBS-001 journalise une 5xx avec corrélation, sans message ni pile', () => {
    const { sink, lines } = capture();
    const filter = new ProblemFilter(sink);
    const res = response();
    filter.catch(new Error('SELECT secret FROM identity.pin'), host(res, { correlationId: 'trace-12345678' }));

    expect(res.statusCode).toBe(500);
    expect(res.contentType).toBe('application/problem+json');
    expect(res.body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(res.body)).not.toContain('SELECT secret');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'error',
      event: 'http_error',
      correlationId: 'trace-12345678',
      status: 500,
      code: 'INTERNAL_ERROR',
      errorName: 'Error',
    });
    expect(lines[0]).not.toContain('SELECT secret');
  });

  it('NF-OBS-001 ne journalise pas les refus métier 4xx', () => {
    const { sink, lines } = capture();
    const filter = new ProblemFilter(sink);
    const res = response();
    filter.catch(new BusinessError('AGREEMENT_LOCKED', 'Objectif verrouillé'), host(res, { correlationId: 'trace-12345678' }));
    expect(res.statusCode).toBe(409);
    expect(lines).toHaveLength(0);
  });

  it('NF-OBS-001 génère une corrélation si la requête n’en porte pas', () => {
    const { sink, lines } = capture();
    const filter = new ProblemFilter(sink);
    const res = response();
    filter.catch(new Error('panne'), host(res, {}));
    const record = JSON.parse(lines[0] ?? '') as { correlationId: string };
    expect(record.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('NF-OBS-001 reste silencieux sans puits de journal configuré', () => {
    const filter = new ProblemFilter(null);
    const res = response();
    expect(() => filter.catch(new Error('panne'), host(res, {}))).not.toThrow();
    expect(res.statusCode).toBe(500);
  });
});
