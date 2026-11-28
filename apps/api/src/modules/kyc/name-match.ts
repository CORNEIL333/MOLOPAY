import { BusinessError } from '@achat/contracts';

/**
 * REG-LBC-002 / D66 : forme comparable d'un nom — décomposition Unicode,
 * accents retirés, majuscules, tout ce qui n'est ni lettre ni chiffre
 * remplacé par une espace, espaces réduites.
 */
/**
 * Lettres cyrilliques et grecques capitales visuellement identiques à une
 * lettre latine (I-1) : ramenées à la lettre latine des deux côtés de la
 * comparaison, pour qu'un homoglyphe ne fasse pas échapper un nom au filtrage.
 */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u0405': 'S', '\u0406': 'I', '\u0408': 'J', '\u041A': 'K', '\u041C': 'M',
  '\u041D': 'H', '\u041E': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X', '\u0423': 'Y', '\u04AE': 'Y',
  '\u04C0': 'I', '\u051A': 'Q', '\u051C': 'W',
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I', '\u039A': 'K', '\u039C': 'M',
  '\u039D': 'N', '\u039F': 'O', '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y', '\u03A7': 'X',
});

/** Forme de comparaison : sans caractère invisible, sans accent, capitales latines, mots séparés par une espace. */
export function normalizeName(name: string): string {
  return name
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[\u0370-\u03FF\u0400-\u052F]/gu, (letter) => CONFUSABLES[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(name: string): ReadonlySet<string> {
  return new Set(normalizeName(name).split(' ').filter((token) => token !== ''));
}

/** Variantes d'un nom listé : tel quel, sans ses parenthèses, et chaque contenu entre parenthèses (sigle). */
function variants(name: string): readonly string[] {
  const inside = [...name.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  return [name, name.replace(/\([^()]*\)/g, ' '), ...inside];
}

function contains(outer: ReadonlySet<string>, inner: ReadonlySet<string>): boolean {
  return [...inner].every((token) => outer.has(token));
}

/**
 * Rapprochement prudent (rappel plutôt que précision ; chaque résultat est
 * examiné par la conformité) : mêmes mots dans n'importe quel ordre, ou
 * inclusion de l'un dans l'autre dès que l'ensemble le plus petit compte au
 * moins deux mots. Un nom d'un seul mot (sigle) n'est rapproché qu'à
 * l'identique. Renvoie les références listées concernées, triées.
 */
export function findPotentialMatches(candidate: string, entries: readonly { readonly reference: string; readonly names: readonly string[] }[]): string[] {
  const subject = tokens(candidate);
  if (subject.size === 0) {
    throw new BusinessError('KYC_INVALID_REQUEST', 'nom à filtrer vide');
  }
  const matches = new Set<string>();
  for (const entry of entries) {
    for (const name of entry.names.flatMap(variants)) {
      const listed = tokens(name);
      if (listed.size === 0) continue;
      const smaller = Math.min(listed.size, subject.size);
      const equal = listed.size === subject.size && contains(listed, subject);
      if (equal || (smaller >= 2 && (contains(subject, listed) || contains(listed, subject)))) {
        matches.add(entry.reference);
        break;
      }
    }
  }
  return [...matches].sort();
}
