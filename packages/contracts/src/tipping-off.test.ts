import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * REG-LBC-004 : interdiction d'informer le client d'un soupçon (« tipping-off »).
 * Aucune route destinée au client ou au partenaire (hors back-office, administration
 * et personnel) n'expose, dans ses requêtes ou ses réponses, un champ ou une valeur
 * énumérée qui parlerait d'un filtrage, d'une sanction, d'une alerte de risque, d'un
 * rapprochement de liste ou d'un niveau KYC. Les schémas sont suivis à travers `$ref`.
 * La réponse au nom légal déclaré est par ailleurs identique octet pour octet avec
 * ou sans rapprochement (test B-1, `kyc-customer-http.db.test.ts`).
 */
const SUSPICION = /screen|sanction|risk|suspic|kyc|alert|match|watchlist|\bpep\b|lbc|aml|soup/i;
// Seule exception : motif de réclamation du client « l'article ne correspond pas à l'offre ».
const ALLOWED = new Set(['OFFER_MISMATCH']);
const INTERNAL_PREFIXES = ['/v1/backoffice', '/v1/admin', '/v1/staff'];

type Node = Record<string, unknown>;
const contract = JSON.parse(readFileSync(resolve(process.cwd(), 'packages/contracts/openapi.json'), 'utf8')) as {
  paths: Record<string, Node>;
  components: Record<string, Record<string, Node>>;
};

function dereference(reference: string): Node {
  const [, , section, name] = reference.split('/');
  const target = section !== undefined && name !== undefined ? contract.components[section]?.[name] : undefined;
  if (target === undefined) throw new Error(`référence introuvable : ${reference}`);
  return target;
}

function vocabulary(node: unknown, seen: Set<string>, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) vocabulary(item, seen, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Node;
  const reference = record['$ref'];
  if (typeof reference === 'string' && !seen.has(reference)) {
    seen.add(reference);
    vocabulary(dereference(reference), seen, out);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const [property, schema] of Object.entries(value)) {
        out.add(property);
        vocabulary(schema, seen, out);
      }
    } else if (key === 'enum' && Array.isArray(value)) {
      for (const item of value) out.add(String(item));
    } else if (key !== 'description' && key !== 'summary') {
      vocabulary(value, seen, out);
    }
  }
}

const external = Object.entries(contract.paths).filter(([path]) => !INTERNAL_PREFIXES.some((prefix) => path.startsWith(prefix)));

describe('REG-LBC-004 aucune route du client ou du partenaire ne révèle un filtrage ou un soupçon', () => {
  it('le parcours couvre les routes du client et du partenaire (garde contre un test vide)', () => {
    const paths = external.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining(['/v1/me', '/v1/me/legal-name', '/v1/me/notifications', '/v1/goals/{goalId}', '/v1/partner/orders']));
    const sample = new Set<string>();
    vocabulary(contract.paths['/v1/me/notifications'], new Set(), sample);
    expect(sample.size).toBeGreaterThan(3);
  });

  it('aucun champ ni valeur énumérée du vocabulaire du soupçon', () => {
    const offenders: string[] = [];
    for (const [path, item] of external) {
      const words = new Set<string>();
      vocabulary(item, new Set(), words);
      for (const word of words) {
        if (SUSPICION.test(word) && !ALLOWED.has(word)) offenders.push(`${path} · ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('les routes internes, elles, portent bien ce vocabulaire (le motif détecte ce qu’il doit)', () => {
    const words = new Set<string>();
    vocabulary(contract.paths['/v1/backoffice/screenings/{screeningId}'], new Set(), words);
    expect([...words].some((word) => SUSPICION.test(word))).toBe(true);
  });
});
