import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7';

describe('UUID v7 du back-office', () => {
  it('format, version 7, variante RFC, horodatage en tête, unicité', () => {
    const at = Date.parse('2026-11-13T10:00:00.000Z');
    const id = uuidv7(at);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(BigInt(`0x${id.replace(/-/g, '').slice(0, 12)}`)).toBe(BigInt(at));
    expect(new Set(Array.from({ length: 200 }, () => uuidv7(at))).size).toBe(200);
  });
});
