import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEC-API-004 : aucun identifiant séquentiel exposé ; UUID v7 côté API.
 * Parcours exhaustif du contrat : tout champ ou paramètre nommé `id` ou `…Id`
 * est un UUID, sauf les références textuelles listées ci-dessous (codes
 * choisis par un humain, jamais un compteur). Aucun identifiant n'est entier.
 * Les seuls entiers de rang exposés sont la position dans une chaîne de
 * hachage (grand livre et audit, lecture interne) et le rang d'une signature
 * dans UN objectif : ni l'un ni l'autre ne désigne une ressource.
 */
const TEXT_REFERENCES = new Set([
  'cityId', // « douala », « yaounde »
  'planId', // code de plan du catalogue
  'partnerId', // code du partenaire (motif ^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$)
  'beneficiaryId', // code du bénéficiaire vérifié (même motif)
  'makerId', // identifiant de connexion du personnel
  'checkerId',
  'subjectId', // sujet d'un filtrage : compte (UUID) ou partenaire (code)
  'targetId',
  'keyId', // empreinte d'une clé de signature
  'rpId', // domaine WebAuthn
  'credentialId', // identifiant WebAuthn opaque, base64url
]);

const RANK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  seq: ['LedgerEntry', 'AuditEvent', 'GoalSigningPayload'],
  afterSeq: ['/v1/admin/ledger/entries', '/v1/admin/audit/events'],
  nextAfterSeq: ['LedgerEntryList', 'AuditEventList'],
};

type Found = { readonly name: string; readonly where: string; readonly schema: Record<string, unknown> };

function collect(document: unknown): Found[] {
  const found: Found[] = [];
  const visit = (node: unknown, where: string, name: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, where, null);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (name !== null) found.push({ name, where, schema: record });
    for (const [key, value] of Object.entries(record)) {
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        for (const [property, schema] of Object.entries(value)) visit(schema, where, property);
      } else if (key === 'items') {
        visit(value, where, name);
      } else if (key === 'parameters' && Array.isArray(value)) {
        for (const parameter of value as Record<string, unknown>[]) {
          if (typeof parameter['name'] === 'string') visit(parameter['schema'] ?? {}, where, parameter['name']);
        }
      } else {
        visit(value, where, null);
      }
    }
  };
  const root = document as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
  for (const [path, item] of Object.entries(root.paths)) visit(item, path, null);
  for (const [schema, body] of Object.entries(root.components.schemas)) visit(body, schema, null);
  return found;
}

function isInteger(schema: Record<string, unknown>): boolean {
  const type = schema['type'];
  return type === 'integer' || (Array.isArray(type) && type.includes('integer'));
}

const contract: unknown = JSON.parse(readFileSync(resolve(process.cwd(), 'packages/contracts/openapi.json'), 'utf8'));
const fields = collect(contract);

describe('SEC-API-004 aucun identifiant séquentiel exposé par le contrat', () => {
  it('tout identifiant est un UUID, ou une référence textuelle listée', () => {
    const offenders = fields
      .filter(({ name }) => name === 'id' || name.endsWith('Id'))
      .filter(({ name, schema }) => schema['format'] !== 'uuid' && !TEXT_REFERENCES.has(name))
      .map(({ name, where }) => `${where} · ${name}`);
    expect(offenders).toEqual([]);
  });

  it('aucun identifiant n’est entier, et les références textuelles sont des chaînes', () => {
    const offenders = fields
      .filter(({ name }) => name === 'id' || name.endsWith('Id'))
      .filter(({ schema }) => isInteger(schema) || (schema['format'] !== 'uuid' && !String(schema['type']).includes('string')))
      .map(({ name, where }) => `${where} · ${name}`);
    expect(offenders).toEqual([]);
  });

  it('les seuls rangs entiers exposés sont ceux des chaînes de hachage et des signatures d’un objectif', () => {
    const ranks = fields.filter(({ name, schema }) => isInteger(schema) && /seq|sequence|number$/i.test(name));
    for (const { name, where } of ranks) {
      expect(RANK_FIELDS[name] ?? [], `${where} · ${name}`).toContain(where);
    }
    expect(ranks.length).toBeGreaterThan(0);
  });

  it('le parcours voit bien les identifiants (garde contre un test vide)', () => {
    expect(fields.filter(({ schema }) => schema['format'] === 'uuid').length).toBeGreaterThan(50);
  });
});
