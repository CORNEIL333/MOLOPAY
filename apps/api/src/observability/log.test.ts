import { describe, expect, it } from 'vitest';
import { maskPhone, serializeLogRecord, type LogRecord } from './log';

const CORRELATION = '019a9500-0000-7000-8000-0000000000aa';
const NOW = new Date('2026-11-19T10:00:00.000Z');

const BASE: LogRecord = {
  level: 'info',
  event: 'http_request',
  correlationId: CORRELATION,
  method: 'GET',
  path: '/health',
  status: 200,
  durationMs: 2.5,
};

function record(extra: Readonly<Record<string, unknown>>): LogRecord {
  return { ...BASE, ...extra };
}

describe('NF-OBS-001 · journal structuré JSON', () => {
  it('NF-OBS-001 produit une seule ligne JSON horodatée avec la corrélation', () => {
    const line = serializeLogRecord(BASE, NOW);
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      time: '2026-11-19T10:00:00.000Z',
      level: 'info',
      event: 'http_request',
      correlationId: CORRELATION,
      method: 'GET',
      path: '/health',
      status: 200,
      durationMs: 2.5,
    });
  });

  it.each(['pin', 'otp', 'legalName', 'idDocument', 'password', 'token', 'message'])(
    'NF-OBS-001 refuse le champ hors liste blanche « %s » (LOG_FIELD_FORBIDDEN)',
    (key) => {
      expect(() => serializeLogRecord(record({ [key]: 'secret' }))).toThrowError('LOG_FIELD_FORBIDDEN');
    },
  );

  it('NF-OBS-001 refuse une valeur imbriquée sous un champ autorisé (LOG_RECORD_INVALID)', () => {
    expect(() => serializeLogRecord(record({ status: { code: 200 } }))).toThrowError('LOG_RECORD_INVALID');
  });

  it.each([0, 99, 600, 200.5, Number.NaN])(
    'NF-OBS-001 refuse un statut hors bornes %s (LOG_RECORD_INVALID)',
    (status) => {
      expect(() => serializeLogRecord(record({ status }))).toThrowError('LOG_RECORD_INVALID');
    },
  );

  it('NF-OBS-001 refuse une durée négative ou non finie (LOG_RECORD_INVALID)', () => {
    expect(() => serializeLogRecord(record({ durationMs: -1 }))).toThrowError('LOG_RECORD_INVALID');
    expect(() => serializeLogRecord(record({ durationMs: Number.POSITIVE_INFINITY }))).toThrowError('LOG_RECORD_INVALID');
  });

  it('NF-OBS-001 refuse un code métier inconnu (LOG_RECORD_INVALID)', () => {
    expect(() => serializeLogRecord(record({ code: 'FORGED_CODE' }))).toThrowError('LOG_RECORD_INVALID');
  });

  it('NF-OBS-001 refuse une corrélation mal formée (LOG_RECORD_INVALID)', () => {
    expect(() => serializeLogRecord(record({ correlationId: 'ligne\ninjectée' }))).toThrowError('LOG_RECORD_INVALID');
  });

  it('NF-OBS-001 neutralise un chemin contenant des caractères non imprimables', () => {
    const parsed = JSON.parse(serializeLogRecord(record({ path: '/v1/offres?pin=1234' }), NOW)) as { path: string };
    expect(parsed.path).toBe('/[redacted]');
  });

  it('NF-OBS-001 ramène une méthode inconnue à OTHER', () => {
    const parsed = JSON.parse(serializeLogRecord(record({ method: 'TRACE-FORGE' }), NOW)) as { method: string };
    expect(parsed.method).toBe('OTHER');
  });

  it('NF-OBS-001 masque un numéro de téléphone sauf les 4 derniers chiffres', () => {
    const line = serializeLogRecord(record({ phone: '+237 612 34 00 01' }), NOW);
    const parsed = JSON.parse(line) as { phone: string };
    expect(parsed.phone).toBe('********0001');
    expect(line).not.toContain('612340001');
  });
});

describe('NF-OBS-001 · masquage des numéros', () => {
  it.each([
    ['+237612340001', '********0001'],
    ['237612340001', '********0001'],
    ['0001', '0001'],
    ['abc', '****'],
  ])('maskPhone(%s) = %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it('maskPhone ne laisse jamais plus de quatre chiffres visibles', () => {
    expect(maskPhone('+237 699 88 77 66').replace(/\D/g, '')).toHaveLength(4);
  });
});
