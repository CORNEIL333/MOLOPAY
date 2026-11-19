import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { parseUnConsolidatedList } from './un-list';

/**
 * REG-LBC-002 / D66 : analyse de la liste consolidée du Conseil de sécurité
 * de l'ONU (format XML officiel). Extrait réel du fichier publié le
 * 2026-11-17 (scsanctions.un.org, SHA-256 du fichier complet
 * 650f48857762c489efb016305878bfb3655db719e2e793a5ccea4b22de5b2bae).
 */
const EXCERPT = readFileSync(resolve(__dirname, 'fixtures/un-consolidated-excerpt.xml'), 'utf8');

describe('REG-LBC-002 liste consolidée ONU', () => {
  it('date de génération, personnes et entités, références, noms et alias', () => {
    const list = parseUnConsolidatedList(EXCERPT);
    expect(list.generatedAt).toBe('2026-11-17T00:00:02.485Z');
    expect(list.entries.map((entry) => `${entry.kind}:${entry.reference}`)).toEqual([
      'INDIVIDUAL:CDi.001',
      'INDIVIDUAL:CDi.002',
      'ENTITY:CDe.001',
      'ENTITY:CDe.002',
      'ENTITY:QDe.109',
    ]);
    const badege = list.entries[0];
    expect(badege?.names).toEqual(['ERIC BADEGE']);
    expect(badege?.listedOn).toBe('2012-12-31');
    expect(list.entries[1]?.names).toContain('FRANK KAKORERE BWAMBALE');
    expect(list.entries[2]?.names).toEqual([
      'ADF',
      'Allied Democratic Forces',
      'Forces Démocratiques Alliées-Armée Nationale de Libération de l’Ouganda',
      'ADF/NALU',
      'NALU',
    ]);
  });

  it('entités XML décodées (&amp;)', () => {
    const list = parseUnConsolidatedList(EXCERPT);
    expect(list.entries[4]?.names.some((name) => name.includes('&'))).toBe(true);
    expect(list.entries[4]?.names.some((name) => name.includes('&amp;'))).toBe(false);
  });

  it.each([
    ['DOCTYPE (entités externes)', (xml: string) => xml.replace('<CONSOLIDATED_LIST', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><CONSOLIDATED_LIST'), /DOCTYPE, CDATA/],
    ['CDATA', (xml: string) => xml.replace('<FIRST_NAME>ERIC</FIRST_NAME>', '<FIRST_NAME><![CDATA[ERIC]]></FIRST_NAME>'), /DOCTYPE, CDATA/],
    ['fermeture manquante au milieu', (xml: string) => xml.replace('</INDIVIDUALS>', ''), /fermeture inattendue <\/CONSOLIDATED_LIST>|fermeture inattendue/],
    ['document tronqué', (xml: string) => xml.replace('</CONSOLIDATED_LIST>', ''), /document incomplet/],
    ['racine inattendue', (xml: string) => xml.replace(/CONSOLIDATED_LIST/g, 'OTHER_LIST'), /racine CONSOLIDATED_LIST/],
    ['entrée sans référence', (xml: string) => xml.replace('<REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>', ''), /référence absente/],
    ['référence en double', (xml: string) => xml.replace('<REFERENCE_NUMBER>CDi.002</REFERENCE_NUMBER>', '<REFERENCE_NUMBER>CDi.001</REFERENCE_NUMBER>'), /référence en double/],
    ['entité inconnue', (xml: string) => xml.replace('&amp;', '&inconnu;'), /entité inconnue/],
    ['vide', () => '', /taille/],
    ['caractère nul (&#0;)', (xml: string) => xml.replace('&amp;', '&#0;'), /caractère interdit en XML/],
    ['caractère de contrôle (&#x1F;)', (xml: string) => xml.replace('&amp;', '&#x1F;'), /caractère interdit en XML/],
    ['demi-substitut (&#xD800;)', (xml: string) => xml.replace('&amp;', '&#xD800;'), /caractère interdit en XML/],
    ['non-caractère (&#xFFFE;)', (xml: string) => xml.replace('&amp;', '&#xFFFE;'), /caractère interdit en XML/],
    ['plus de 64 Mio en UTF-8 (moins de 64 Mi unités UTF-16)', (xml: string) => xml.replace('</CONSOLIDATED_LIST>', `<!--${'é'.repeat(33 * 1024 * 1024)}--></CONSOLIDATED_LIST>`), /taille/],
  ] as const)('refuse : %s', (_label, alter, message) => {
    let caught: unknown;
    try {
      parseUnConsolidatedList(alter(EXCERPT));
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BusinessError);
    expect((caught as BusinessError).code).toBe('KYC_LIST_INVALID');
    expect((caught as BusinessError).message).toMatch(message);
  });

  it('liste réelle complète si fournie (UN_LIST_PATH) : 1007 entrées attendues le 2026-11-17', () => {
    const path = process.env['UN_LIST_PATH'];
    if (path === undefined) {
      return;
    }
    const list = parseUnConsolidatedList(readFileSync(path, 'utf8'));
    expect(list.entries.filter((entry) => entry.kind === 'INDIVIDUAL')).toHaveLength(733);
    expect(list.entries.filter((entry) => entry.kind === 'ENTITY')).toHaveLength(274);
  });
});
