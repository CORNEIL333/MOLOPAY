import { describe, expect, it } from 'vitest';
import { factKey } from './notify';

describe('INT-IDEM-004 clé d’événement dérivée d’un fait', () => {
  it('même fait, même clé ; fait différent, clé différente', () => {
    expect(factKey('dispute-opened', 'a')).toBe(factKey('dispute-opened', 'a'));
    expect(factKey('dispute-opened', 'a')).not.toBe(factKey('dispute-resolved', 'a'));
    expect(factKey('a', 'b|c')).not.toBe(factKey('a|b', 'c'));
  });

  it('forme UUID version 8, variante RFC 9562', () => {
    for (const part of ['x', 'y', 'z', '019a']) {
      expect(factKey(part)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});
