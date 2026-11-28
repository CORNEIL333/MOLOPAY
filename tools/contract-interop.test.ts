import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toProblem } from '../apps/api/src/http/problem';

/** NF-COMP-002 : API publique décrite en OpenAPI 3.1 ; toute erreur au format RFC 9457 (application/problem+json). */
type Node = Record<string, unknown>;
const contract = JSON.parse(readFileSync(resolve(process.cwd(), 'packages/contracts/openapi.json'), 'utf8')) as {
  openapi: string;
  paths: Record<string, Record<string, Node>>;
  components: { responses: Record<string, Node>; schemas: Record<string, Node> };
};

describe('NF-COMP-002 OpenAPI 3.1 et erreurs RFC 9457', () => {
  it('le contrat est en OpenAPI 3.1', () => {
    expect(contract.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it('chaque réponse 4xx/5xx de chaque route renvoie vers une réponse partagée application/problem+json du schéma Problem', () => {
    const offenders: string[] = [];
    let counted = 0;
    for (const [path, item] of Object.entries(contract.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        const responses = operation['responses'] as Record<string, Node> | undefined;
        if (responses === undefined) continue;
        for (const [status, response] of Object.entries(responses)) {
          if (!/^[45]/.test(status) && status !== 'default') continue;
          counted += 1;
          const reference = response['$ref'];
          const name = typeof reference === 'string' ? reference.replace('#/components/responses/', '') : '';
          const shared = contract.components.responses[name];
          const content = shared?.['content'] as Record<string, { schema?: { $ref?: string } }> | undefined;
          if (content === undefined || Object.keys(content).join() !== 'application/problem+json'
            || content['application/problem+json']?.schema?.$ref !== '#/components/schemas/Problem') {
            offenders.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    expect(counted).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it('le schéma Problem porte les membres RFC 9457 ; le filtre d’erreur produit ces membres', () => {
    const schema = contract.components.schemas['Problem'] as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(['type', 'title', 'status']));
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(['type', 'title', 'status', 'detail']));
    const problem = toProblem({ code: 'P0001', message: 'AGREEMENT_LOCKED: objectif déjà verrouillé' });
    expect(problem).toMatchObject({ type: expect.stringMatching(/^urn:/) as unknown, title: expect.any(String) as unknown, status: 409, code: 'AGREEMENT_LOCKED' });
  });
});
