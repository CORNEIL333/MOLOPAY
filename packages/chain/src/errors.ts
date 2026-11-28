export type ChainErrorCode =
  | 'CHAIN_INVALID_CONTENT'
  | 'CHAIN_INVALID_HASH'
  | 'MERKLE_INVALID_ARGUMENT'
  | 'MERKLE_INVALID_PROOF'
  | 'STH_INVALID'
  | 'TIMESTAMP_INVALID';

export class ChainError extends Error {
  public readonly code: ChainErrorCode;

  public constructor(code: ChainErrorCode, message: string) {
    super(message);
    this.name = 'ChainError';
    this.code = code;
  }
}
