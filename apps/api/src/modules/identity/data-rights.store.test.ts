import { describe, expect, it } from 'vitest';
import { parseDataRight, parseRightsCursor } from './data-rights.store';

describe('F-ACC-005 · demandes de droits fermées', () => {
  for (const kind of ['ACCESS', 'RECTIFICATION', 'OBJECTION', 'ERASURE']) {
    it(`accepte ${kind} sans donnée libre`, () => { expect(parseDataRight({ kind })).toBe(kind); });
  }
  for (const body of [undefined, null, [], 'ACCESS', {}, { kind: 'EXPORT' }, { kind: 'ACCESS', accountId: 'foreign' },
    { kind: 'RECTIFICATION', value: 'donnée personnelle' }, Object.create({ kind: 'ACCESS' })]) {
    it('refuse le corps non autorisé : REQUEST_INVALID', () => {
      expect(() => parseDataRight(body)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
  it('refuse les accesseurs sans les exécuter', () => {
    let read = false;
    expect(() => parseDataRight({ get kind() { read = true; return 'ACCESS'; } })).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    expect(read).toBe(false);
  });
  it('accepte un curseur UUIDv7 ou aucune pagination', () => {
    expect(parseRightsCursor({})).toBeNull();
    expect(parseRightsCursor({ before: '019a9500-0000-7000-8000-000000000001' })).toBe('019a9500-0000-7000-8000-000000000001');
  });
  for (const query of [{ accountId: 'foreign' }, { before: ['a', 'b'] }, { before: '' }, { before: 'bad' }, { before: '00000000-0000-4000-8000-000000000000' }, null]) {
    it('refuse le filtre non autorisé : REQUEST_INVALID', () => {
      expect(() => parseRightsCursor(query)).toThrow(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    });
  }
});
