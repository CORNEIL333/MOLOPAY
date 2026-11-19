import { type ArgumentsHost, HttpException } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import type { LogSink } from '../observability/log';
import { ProblemFilter } from './problem.filter';

type FakeResponse = {
  statusCode: number;
  contentType: string | undefined;
  body: unknown;
  headers: Record<string, string>;
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
    headers: {},
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
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

describe('NF-COMP-002 · refus de la couche HTTP (statut réel, sans fuite)', () => {
  it('un 401 n’est plus présenté comme une 400', () => {
    const filter = new ProblemFilter(null);
    const res = response();
    filter.catch(new HttpException('Session absente', 401), host(res, { correlationId: 'trace-12345678' }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ status: 401, code: 'REQUEST_UNAUTHENTICATED', title: 'Authentification requise' });
    expect(res.headers['content-language']).toBe('fr');
  });

  it('un 405 conserve son statut', () => {
    const filter = new ProblemFilter(null);
    const res = response();
    filter.catch(new HttpException('Method Not Allowed', 405), host(res, {}));
    expect(res.statusCode).toBe(405);
    expect(res.body).toMatchObject({ status: 405, code: 'REQUEST_METHOD_NOT_ALLOWED' });
  });

  it('une 500 levée en HttpException est journalisée et ne divulgue pas son message', () => {
    const { sink, lines } = capture();
    const filter = new ProblemFilter(sink);
    const res = response();
    filter.catch(new HttpException('SELECT secret FROM identity.pin', 500), host(res, { correlationId: 'trace-12345678' }));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      type: 'urn:achat:problem:internal-error',
      title: 'Erreur interne',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.body)).not.toContain('SELECT secret');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('SELECT secret');
  });

  it('Accept-Language: en renvoie le titre anglais et l’en-tête Content-Language', () => {
    const filter = new ProblemFilter(null);
    const res = response();
    filter.catch(
      new HttpException('Not Found', 404),
      host(res, { correlationId: 'trace-12345678', headers: { 'accept-language': 'en-GB,en;q=0.9' } }),
    );
    expect(res.body).toMatchObject({ status: 404, code: 'ROUTE_NOT_FOUND', title: 'Resource not found' });
    expect(res.headers['content-language']).toBe('en');
  });

  it('sans Accept-Language, le français reste la langue par défaut', () => {
    const filter = new ProblemFilter(null);
    const res = response();
    filter.catch(new HttpException('Not Found', 404), host(res, {}));
    expect(res.body).toMatchObject({ title: 'Ressource introuvable' });
    expect(res.headers['content-language']).toBe('fr');
  });
});
