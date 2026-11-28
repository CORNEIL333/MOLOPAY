import type { components } from '@achat/contracts/api';

type Offer = components['schemas']['Offer'];

const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['moto', 'scooter', 'boxer', 'motorbike', 'vehicule', 'deuxroues', 'mobilite'],
  ['frigo', 'refrigerateur', 'congelateur', 'froid', 'fridge', 'freezer'],
  ['telephone', 'smartphone', 'mobile', 'phone', 'android', 'iphone'],
  ['ordinateur', 'laptop', 'pc', 'portable', 'informatique'],
  ['loyer', 'caution', 'bail', 'logement', 'maison', 'rent', 'lease'],
  ['ecole', 'scolarite', 'universite', 'frais', 'school', 'tuition'],
  ['matelas', 'lit', 'chambre', 'meuble'],
  ['ciment', 'materiaux', 'tole', 'terrain', 'chantier'],
];

export function normalizeSearchText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = up;
    }
  }
  return prev[b.length] ?? 3;
}

function expandTerms(term: string): readonly string[] {
  const out = new Set<string>([term]);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((w) => w === term || (term.length >= 4 && levenshtein(w, term) <= 1))) {
      for (const w of group) out.add(w);
    }
  }
  return [...out];
}

export function searchOffers(offers: readonly Offer[], query: string): readonly Offer[] {
  const q = normalizeSearchText(query);
  if (q === '') return offers;
  const queryWords = q.split(' ').filter((w) => w.length > 0);
  return offers.filter((offer) => {
    const haystack = normalizeSearchText(`${offer.title} ${offer.partnerName} ${offer.universe}`);
    const hayWords = haystack.split(' ').filter((w) => w.length > 0);
    return queryWords.every((qw) => {
      const candidates = expandTerms(qw);
      return candidates.some((cand) =>
        haystack.includes(cand) ||
        (cand.length >= 4 && hayWords.some((hw) => hw.length >= 4 && levenshtein(hw, cand) <= 2)));
    });
  });
}
