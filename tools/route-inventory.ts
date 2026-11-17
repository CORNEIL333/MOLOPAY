import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildRouteInventory, ROUTE_INVENTORY_PATH } from '../apps/api/src/route-inventory';

/** Lot 25 : régénère l'inventaire des routes (aucune base, aucun réseau). */
const target = resolve(__dirname, '..', ROUTE_INVENTORY_PATH);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildRouteInventory());
console.log(`INVENTORY WRITTEN ${ROUTE_INVENTORY_PATH}`);
