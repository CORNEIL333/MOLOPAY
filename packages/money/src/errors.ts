export type MoneyErrorCode =
  | 'INVALID_AMOUNT'
  | 'AMOUNT_OVERFLOW'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_ALLOCATION';

export class MoneyError extends Error {
  public readonly code: MoneyErrorCode;

  public constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}
