import { formatXaf } from '@achat/ui';

export const MP_FAVORITES_STORAGE_KEY = 'mp_favorites_v1';

export type StoredFavorite = { readonly offerId: string; readonly addedPriceXaf: string; readonly addedAt: string };
export type FavoritePriceDelta =
  | { readonly kind: 'SAME' }
  | { readonly kind: 'DOWN'; readonly deltaXaf: string }
  | { readonly kind: 'UP'; readonly deltaXaf: string };

const CANONICAL_DIGITS = /^(?:0|[1-9][0-9]*)$/;

function parseCanonicalBigInt(raw: string): bigint {
  formatXaf(raw);
  return BigInt(raw);
}

export function parseStoredFavorites(raw: string | null): readonly StoredFavorite[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: StoredFavorite[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const offerId = typeof rec['offerId'] === 'string' ? rec['offerId'].trim() : '';
      const addedPriceXaf = typeof rec['addedPriceXaf'] === 'string' ? rec['addedPriceXaf'] : '';
      const addedAt = typeof rec['addedAt'] === 'string' ? rec['addedAt'] : '';
      if (offerId === '' || addedAt === '' || !CANONICAL_DIGITS.test(addedPriceXaf)) continue;
      out.push({ offerId, addedPriceXaf, addedAt });
    }
    return out;
  } catch { return []; }
}

export function toggleStoredFavorite(
  current: readonly StoredFavorite[],
  input: { readonly offerId: string; readonly priceXaf: string; readonly nowIso: string },
): readonly StoredFavorite[] {
  parseCanonicalBigInt(input.priceXaf);
  return current.some((f) => f.offerId === input.offerId)
    ? current.filter((f) => f.offerId !== input.offerId)
    : [...current, { offerId: input.offerId, addedPriceXaf: input.priceXaf, addedAt: input.nowIso }];
}

export function computeFavoritePriceDelta(addedPriceXaf: string, currentPriceXaf: string): FavoritePriceDelta {
  const added = parseCanonicalBigInt(addedPriceXaf);
  const current = parseCanonicalBigInt(currentPriceXaf);
  if (current === added) return { kind: 'SAME' };
  return current < added
    ? { kind: 'DOWN', deltaXaf: (added - current).toString() }
    : { kind: 'UP', deltaXaf: (current - added).toString() };
}
