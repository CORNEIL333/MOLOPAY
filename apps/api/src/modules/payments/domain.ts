import { createHmac, timingSafeEqual } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC_SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MIN_WEBHOOK_SECRET_BYTES = 32;

// F-PAY-001 : mobile money via l'agrégateur, carte par page hébergée,
// espèces chez un partenaire habilité. L'agrégateur n'est pas encore choisi :
// le canal décrit le moyen de paiement, pas le prestataire.
export const PAYMENT_CHANNELS = ['MTN_MOMO', 'ORANGE_MONEY', 'CARD', 'CASH'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

// CDC_05 § 5.1.
export const PAYMENT_ATTEMPT_STATUSES = [
  'CREATED',
  'PENDING',
  'CONFIRMED',
  'FAILED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

// Liste blanche des transitions (INT-IDEM-003). Tout le reste est refusé.
const ALLOWED_TRANSITIONS: Readonly<Record<PaymentAttemptStatus, readonly PaymentAttemptStatus[]>> = {
  CREATED: ['PENDING'],
  PENDING: ['CONFIRMED', 'FAILED', 'EXPIRED'],
  CONFIRMED: ['REFUND_PENDING'],
  FAILED: [],
  EXPIRED: [],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

// SEC-API-002 : horodatage ± 5 min.
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type PaymentAttempt = {
  readonly id: string;
  readonly agreementId: string;
  readonly channel: PaymentChannel;
  readonly amountXaf: bigint;
  readonly idemKey: string;
  readonly status: PaymentAttemptStatus;
};

export type CreatePaymentAttemptInput = {
  readonly id: string;
  readonly agreementId: string;
  readonly channel: string;
  readonly amountXaf: bigint;
  readonly idemKey: string;
};

function invalid(message: string): never {
  throw new BusinessError('PAYMENT_INVALID_REQUEST', message);
}

export function isPaymentChannel(value: string): value is PaymentChannel {
  return (PAYMENT_CHANNELS as readonly string[]).includes(value);
}

export function isPaymentAttemptStatus(value: string): value is PaymentAttemptStatus {
  return (PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(value);
}

/** Valide une nouvelle tentative (F-PAY-001/002). Aucun effet de bord. */
export function createPaymentAttempt(input: CreatePaymentAttemptInput): PaymentAttempt {
  if (!UUID_V7_PATTERN.test(input.id)) {
    invalid('identifiant de tentative : UUID v7 attendu');
  }
  if (!UUID_PATTERN.test(input.agreementId)) {
    invalid('identifiant d’accord : UUID attendu');
  }
  if (!isPaymentChannel(input.channel)) {
    invalid('canal de paiement non autorisé');
  }
  if (!UUID_PATTERN.test(input.idemKey)) {
    invalid('clé d’idempotence : UUID attendu');
  }
  const amount = xaf(input.amountXaf).amount;
  if (amount <= 0n) {
    throw new BusinessError('INVALID_AMOUNT', 'montant strictement positif attendu');
  }
  return Object.freeze({
    id: input.id,
    agreementId: input.agreementId,
    channel: input.channel,
    amountXaf: amount,
    idemKey: input.idemKey,
    status: 'CREATED',
  });
}

export function isAllowedAttemptTransition(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Applique une transition (CDC_05 § 5.1, F-PAY-004, INT-IDEM-005).
 * Un paiement confirmé ne revient jamais à un état non payé ; CONFIRMED
 * exige un identifiant de transaction vérifié auprès du prestataire.
 */
export function transitionAttempt(
  from: PaymentAttemptStatus,
  to: PaymentAttemptStatus,
  context: { readonly providerTxVerified: boolean },
): PaymentAttemptStatus {
  if (!isAllowedAttemptTransition(from, to)) {
    if (from === 'CONFIRMED') {
      throw new BusinessError('PAYMENT_ALREADY_CONFIRMED', `CONFIRMED → ${to} interdite`);
    }
    throw new BusinessError('UNAUTHORIZED_TRANSITION', `${from} → ${to} interdite`);
  }
  if (to === 'CONFIRMED' && !context.providerTxVerified) {
    throw new BusinessError(
      'PAYMENT_CONFIRMATION_UNVERIFIED',
      'CONFIRMED exige une transaction vérifiée par l’API du prestataire',
    );
  }
  return to;
}

export type WebhookSignatureInput = {
  /** Secret partagé, fourni par la configuration (jamais dans le code). */
  readonly secret: Buffer;
  /** Message signé, construit par l'adaptateur officiel selon la doc du prestataire. */
  readonly signedPayload: Buffer;
  readonly signatureHex: string;
  readonly timestampSeconds: number;
  readonly nowMs: number;
};

/**
 * SEC-API-002 / F-PAY-003 : signature HMAC-SHA256 vérifiée en temps constant,
 * horodatage ± 5 min. Le format du message signé dépend du prestataire et
 * reste à la charge de son adaptateur ; l'anti-rejeu par nonce est imposé en
 * base (payments.webhook_receipt). Ne vaut pas confirmation : le paiement
 * n'est confirmé qu'après interrogation de l'API du prestataire.
 */
export function verifyWebhookSignature(input: WebhookSignatureInput): void {
  if (
    !Number.isSafeInteger(input.timestampSeconds) ||
    Math.abs(Math.floor(input.nowMs / 1000) - input.timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new BusinessError('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW', 'horodatage hors fenêtre');
  }
  if (
    input.secret.length < MIN_WEBHOOK_SECRET_BYTES ||
    !HMAC_SHA256_HEX_PATTERN.test(input.signatureHex)
  ) {
    throw new BusinessError('WEBHOOK_SIGNATURE_INVALID', 'signature refusée');
  }
  const expected = createHmac('sha256', input.secret).update(input.signedPayload).digest();
  const received = Buffer.from(input.signatureHex, 'hex');
  if (!timingSafeEqual(expected, received)) {
    throw new BusinessError('WEBHOOK_SIGNATURE_INVALID', 'signature refusée');
  }
}
