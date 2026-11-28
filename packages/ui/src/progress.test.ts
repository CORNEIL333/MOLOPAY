import { describe, expect, it } from 'vitest';
import { assertProgressPercent } from './progress';

describe('assertProgressPercent', () => {
  it.each([0, 1, 42, 99, 100])('accepte %i', (percent) => {
    expect(() => assertProgressPercent(percent)).not.toThrow();
  });

  it.each([-1, 101, 42.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuse %s',
    (percent) => {
      expect(() => assertProgressPercent(percent)).toThrowError(
        'PROGRESS_PERCENT_INVALID',
      );
    },
  );
});
