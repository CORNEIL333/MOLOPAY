import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';

type SqlClient = Pick<PoolClient, 'query'>;

/**
 * Marques diacritiques retirées par la base (`kyc.normalize_name`, 0063) : un
 * nom déclaré ne peut contenir aucune autre marque (IMP-2), de sorte que la
 * normalisation SQL et celle-ci coïncident sur tout nom accepté.
 */
const NORMALIZED_MARK_RANGES: readonly (readonly [number, number])[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20ff], [0xfe20, 0xfe2f],
];
export const NORMALIZED_MARKS = new RegExp(
  `[${NORMALIZED_MARK_RANGES.map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`).join('')}]`,
  'gu',
);

/**
 * REG-LBC-001 / D68 : déclaration du nom légal par le client (versions en
 * ajout seul). Le nom est une donnée personnelle exigée par le niveau 1 :
 * jamais journalisé, jamais renvoyé ailleurs qu'au client lui-même.
 */
/** Écritures dont des lettres imitent les lettres latines ; toute autre écriture forme un seul groupe. */
const SCRIPTS: readonly (readonly [string, RegExp])[] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Cherokee', /\p{Script=Cherokee}/u],
  ['Coptic', /\p{Script=Coptic}/u],
];

function scriptOf(letter: string): string {
  return SCRIPTS.find(([, pattern]) => pattern.test(letter))?.[0] ?? 'Other';
}

/**
 * Nom légal déclaré (D68). Refusés (I-1) : caractères de contrôle, de format
 * ou invisibles (ils coupent un mot et feraient échapper le nom au filtrage)
 * et mélange d'écritures dans un même nom (homoglyphes).
 */
export function parseLegalName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal attendu');
  }
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 200 || /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(value) || !/\p{L}/u.test(name)) {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal invalide (2 à 200 caractères, lettres)');
  }
  // IMP-2 : après décomposition et retrait des marques normalisées par la base,
  // seuls lettres, chiffres et séparateurs admis (liste blanche identique en base).
  if (/[^\p{L}\p{N} '’ʼ.,-]/u.test(name.normalize('NFKD').replace(NORMALIZED_MARKS, ''))) {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal invalide (lettres, chiffres, espace, tiret, apostrophe, point, virgule)');
  }
  const scripts = new Set([...name.matchAll(/\p{L}/gu)].map(([letter]) => scriptOf(letter)));
  if (scripts.size > 1) {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom légal invalide (une seule écriture)');
  }
  return name;
}

export async function insertLegalNameDeclaration(client: SqlClient, input: { readonly id: string; readonly accountId: string; readonly legalName: string }): Promise<void> {
  await client.query(
    'INSERT INTO identity.legal_name_declaration (id, account_id, legal_name, declared_at) VALUES ($1, $2, $3, now())',
    [input.id, input.accountId, parseLegalName(input.legalName)],
  );
}
