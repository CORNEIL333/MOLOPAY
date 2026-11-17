import { BusinessError } from '@achat/contracts';

/**
 * REG-LBC-002 / D66 : forme comparable d'un nom — décomposition Unicode,
 * accents retirés, majuscules, tout ce qui n'est ni lettre ni chiffre
 * remplacé par une espace, espaces réduites.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
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
