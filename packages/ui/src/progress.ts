export function assertProgressPercent(percent: number): void {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new RangeError('PROGRESS_PERCENT_INVALID');
  }
}
