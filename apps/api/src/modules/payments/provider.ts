import type { PaymentChannel } from './domain';

/**
 * Port vers un prestataire de paiement (lot 11, F-PAY-001/003).
 *
 * Contrat seulement : aucune implémentation n'existe dans ce dépôt. Chaque
 * adaptateur sera écrit d'après la documentation officielle du prestataire
 * retenu (agrégateur non encore choisi) et testé contre son environnement de
 * test officiel. Aucun faux prestataire ne doit implémenter ce port
 * (AGENTS.md § 8, zéro simulation).
 */
export interface PaymentProvider {
  /** Canaux servis par ce prestataire. */
  readonly channels: readonly PaymentChannel[];

  /**
   * Demande de paiement auprès du prestataire. La clé d'idempotence de la
   * tentative est transmise telle quelle pour qu'un rejeu ne débite qu'une fois.
   */
  initiate(request: ProviderPaymentRequest): Promise<ProviderPaymentHandle>;

  /**
   * Interrogation de l'API du prestataire (F-PAY-003, SEC-API-002) : seule
   * source acceptée pour passer une tentative à CONFIRMED.
   */
  fetchTransaction(providerTxId: string): Promise<ProviderTransaction>;

  /**
   * Extrait d'un webhook brut les éléments à authentifier, selon le format
   * documenté par le prestataire. Ne fait aucune vérification lui-même :
   * la vérification est `verifyWebhookSignature` puis l'anti-rejeu en base.
   */
  parseWebhook(rawBody: Buffer, headers: Readonly<Record<string, string>>): ProviderWebhook;
}

export type ProviderPaymentRequest = {
  readonly attemptId: string;
  readonly idemKey: string;
  readonly channel: PaymentChannel;
  readonly amountXaf: bigint;
};

export type ProviderPaymentHandle = {
  readonly providerTxId: string;
};

/** État lu chez le prestataire, réduit à ce que le grand livre a besoin de savoir. */
export type ProviderTransaction = {
  readonly providerTxId: string;
  readonly attemptId: string;
  readonly amountXaf: bigint;
  readonly outcome: 'SUCCEEDED' | 'FAILED' | 'PENDING';
};

export type ProviderWebhook = {
  readonly nonce: string;
  readonly timestampSeconds: number;
  readonly signatureHex: string;
  readonly signedPayload: Buffer;
  readonly providerTxId: string;
};
