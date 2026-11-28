import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRouteInventory, ROUTE_INVENTORY_PATH } from './route-inventory';

/**
 * Lot 25 / CDC_07 : l'inventaire de la surface d'attaque remis aux testeurs
 * (pentest) est généré depuis le code et doit rester exact : toute route
 * ajoutée ou modifiée sans régénération fait échouer ce test
 * (`pnpm routes:inventory`).
 */
describe('Lot 25 inventaire des routes pour la recette', () => {
  it('le document versionné correspond exactement aux routes déclarées', () => {
    const committed = readFileSync(resolve(__dirname, '../../..', ROUTE_INVENTORY_PATH), 'utf8');
    expect(committed).toBe(buildRouteInventory());
  });

  it('chaque route a un espace d’authentification et une politique de cache ; les écritures exigent Origin et Idempotency-Key', () => {
    const lines = buildRouteInventory().split('\n').filter((line) => line.startsWith('| `'));
    expect(lines.length).toBeGreaterThan(60);
    for (const line of lines) {
      const cells = line.split('|').map((cell) => cell.trim());
      const [, method, , space, cache, origin, idempotency] = cells;
      expect(['public', 'client', 'personnel', 'partenaire']).toContain(space);
      expect(cache).not.toBe('');
      if (method === '`POST`' || method === '`DELETE`') {
        expect(origin).toBe('oui');
        expect(idempotency).toBe('oui');
      }
    }
  });
});
