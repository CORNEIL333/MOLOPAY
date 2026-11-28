import { describe, expect, it } from 'vitest';
import { ordersCsv } from './partner-csv';

const ORDER = {
  orderId: '019ab100-0000-7000-8000-0000000000a1',
  offerId: '019ab100-0000-7000-8000-0000000000f1',
  offerTitle: 'Réfrigérateur 200 L',
  status: 'FUNDED',
  targetXaf: '150000',
  progressBasisPoints: 10000,
  createdAt: '2026-11-01T09:00:00.000Z',
  handedOverAt: null,
};

describe('F-PRT-004 export CSV des commandes', () => {
  it('en-tête puis une ligne par commande, CRLF, champs vides pour null', () => {
    expect(ordersCsv([ORDER])).toBe(
      'orderId,offerId,offerTitle,status,targetXaf,progressBasisPoints,createdAt,handedOverAt\r\n' +
        '019ab100-0000-7000-8000-0000000000a1,019ab100-0000-7000-8000-0000000000f1,Réfrigérateur 200 L,FUNDED,150000,10000,2026-11-01T09:00:00.000Z,\r\n',
    );
  });

  it('guillemets, virgules et retours à la ligne échappés (RFC 4180)', () => {
    const line = ordersCsv([{ ...ORDER, offerTitle: 'Lot "A", 2\nportes' }]).split('\r\n')[1];
    expect(line).toContain('"Lot ""A"", 2\nportes"');
  });

  it('un retour à la ligne seul impose aussi les guillemets', () => {
    expect(ordersCsv([{ ...ORDER, offerTitle: 'deux\nlignes' }])).toContain(',"deux\nlignes",');
  });

  it.each(['=HYPERLINK("x")', '+33', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])('cellule commençant par un caractère de formule neutralisée : %s', (title) => {
    const cell = ordersCsv([{ ...ORDER, offerTitle: title }]).split('\r\n')[1]?.split(',')[2] ?? '';
    expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('liste vide : en-tête seul', () => {
    expect(ordersCsv([])).toBe('orderId,offerId,offerTitle,status,targetXaf,progressBasisPoints,createdAt,handedOverAt\r\n');
  });
});
