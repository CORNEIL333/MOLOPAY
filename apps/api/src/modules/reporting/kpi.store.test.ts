import { describe, expect, it } from 'vitest';
import { averageFloor, breakdown, MASK_BELOW, ratePercent } from './kpi.store';

/** F-REP-002 : règles de publication des définitions écrites (masquage, arrondi). */
describe('F-REP-002 — masquage des petites cases et arrondi du taux', () => {
  const rows = (count: number, key: string): { id: string; universe: string; city: string; amount: bigint }[] =>
    Array.from({ length: count }, (_, index) => ({ id: `${key}-${index}`, universe: key, city: 'douala', amount: 1_000n }));

  it('une case est publiée à partir de 5 objectifs distincts, masquée en dessous ; cases triées', () => {
    expect(MASK_BELOW).toBe(5);
    const cells = breakdown([...rows(5, 'TECHNOLOGY'), ...rows(4, 'HOUSING')], 'universe', true);
    expect(cells).toEqual([
      { key: 'HOUSING', goals: '<5', amountXaf: '<5' },
      { key: 'TECHNOLOGY', goals: 5, amountXaf: '5000' },
    ]);
  });

  it('un objectif compte une fois par case même avec plusieurs lignes ; sans montant si non demandé', () => {
    const repeated = [...rows(4, 'TECHNOLOGY'), { id: 'TECHNOLOGY-0', universe: 'TECHNOLOGY', city: 'douala', amount: 500n }];
    expect(breakdown(repeated, 'universe', true)).toEqual([{ key: 'TECHNOLOGY', goals: '<5', amountXaf: '<5' }]);
    expect(breakdown(rows(6, 'MOBILITY'), 'city', false)).toEqual([{ key: 'douala', goals: 6 }]);
  });

  it('taux : une décimale, demi vers le haut ; non publié sans dénominateur', () => {
    expect(ratePercent(2, 3)).toBe('66.7');
    expect(ratePercent(1, 3)).toBe('33.3');
    expect(ratePercent(1, 8)).toBe('12.5');
    expect(ratePercent(1, 16)).toBe('6.3');
    expect(ratePercent(3, 3)).toBe('100.0');
    expect(ratePercent(0, 4)).toBe('0.0');
    expect(ratePercent(0, 0)).toBeNull();
  });

  it('marge moyenne : entier arrondi à l’inférieur ; non publiée sans commande', () => {
    expect(averageFloor(3750n, 1)).toBe('3750');
    expect(averageFloor(7501n, 2)).toBe('3750');
    expect(averageFloor(10n, 3)).toBe('3');
    expect(averageFloor(0n, 0)).toBeNull();
  });
});
