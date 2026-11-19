import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SEC-API-005 / IMP-3 rendu dynamique du back-office', () => {
  it('la mise en page force le rendu à la requête : le nonce de la CSP est appliqué aux scripts (une page statique n’en reçoit pas)', () => {
    // Next.js exige une constante littérale dans le fichier de mise en page : on vérifie la source elle-même.
    const source = readFileSync(resolve(__dirname, 'layout.tsx'), 'utf8');
    expect(source).toMatch(/^export const dynamic = 'force-dynamic';$/m);
  });
});
