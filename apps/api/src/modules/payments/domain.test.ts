import { createHmac, randomBytes } from 'node:crypto';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_ATTEMPT_STATUSES,
  WEBHOOK_TOLERANCE_SECONDS,
  createPaymentAttempt,
  isAllowedAttemptTransition,
  transitionAttempt,
  verifyWebhookSignature,
  type PaymentAttemptStatus,
} from './domain';

const ATTEMPT_ID = '019a9200-0000-7000-8000-000000000001';
const AGREEMENT_ID = '019a9200-0000-7000-8000-0000000000a1';
const IDEM_KEY = '019a9200-0000-7000-8000-0000000000e1';

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return error.code;
    }
    throw error;
  }
  throw new Error('Échec attendu, aucune erreur levée');
}

function validInput(): Parameters<typeof createPaymentAttempt>[0] {
  return {
    id: ATTEMPT_ID,
    agreementId: AGREEMENT_ID,
    channel: 'MTN_MOMO',
    amountXaf: 5_000n,
    idemKey: IDEM_KEY,
  };
}

describe('F-PAY-001 création d’une tentative', () => {
  it('crée une tentative CREATED pour un canal autorisé', () => {
    const attempt = createPaymentAttempt(validInput());
    expect(attempt.status).toBe('CREATED');
    expect(attempt.amountXaf).toBe(5_000n);
  });

  it.each(['MTN_MOMO', 'ORANGE_MONEY', 'CARD', 'CASH'] as const)(
    'F-PAY-001 accepte le canal %s',
    (channel) => {
      expect(createPaymentAttempt({ ...validInput(), channel }).channel).toBe(channel);
    },
  );

  it('refuse un canal hors liste blanche (PAYMENT_INVALID_REQUEST)', () => {
    expect(codeOf(() => createPaymentAttempt({ ...validInput(), channel: 'PAYPAL' }))).toBe(
      'PAYMENT_INVALID_REQUEST',
    );
  });

  it.each([0n, -1n])('NF-FUN-001 refuse le montant %s (INVALID_AMOUNT)', (amountXaf) => {
    expect(codeOf(() => createPaymentAttempt({ ...validInput(), amountXaf }))).toBe(
      'INVALID_AMOUNT',
    );
  });

  it('F-PAY-002 refuse une tentative sans clé d’idempotence UUID (PAYMENT_INVALID_REQUEST)', () => {
    expect(codeOf(() => createPaymentAttempt({ ...validInput(), idemKey: '' }))).toBe(
      'PAYMENT_INVALID_REQUEST',
    );
    expect(codeOf(() => createPaymentAttempt({ ...validInput(), idemKey: 'cle-1' }))).toBe(
      'PAYMENT_INVALID_REQUEST',
    );
  });

  it('refuse un identifiant qui n’est pas un UUID v7 (PAYMENT_INVALID_REQUEST)', () => {
    expect(
      codeOf(() =>
        createPaymentAttempt({ ...validInput(), id: '00000000-0000-4000-8000-000000000001' }),
      ),
    ).toBe('PAYMENT_INVALID_REQUEST');
    expect(codeOf(() => createPaymentAttempt({ ...validInput(), agreementId: 'a-1' }))).toBe(
      'PAYMENT_INVALID_REQUEST',
    );
  });
});

describe('CDC_05 § 5.1 / F-PAY-004 machine à états de la tentative', () => {
  const allowed: ReadonlyArray<readonly [PaymentAttemptStatus, PaymentAttemptStatus]> = [
    ['CREATED', 'PENDING'],
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'EXPIRED'],
    ['CONFIRMED', 'REFUND_PENDING'],
    ['REFUND_PENDING', 'REFUNDED'],
  ];

  it('INT-IDEM-003 n’autorise que les six transitions déclarées', () => {
    for (const from of PAYMENT_ATTEMPT_STATUSES) {
      for (const to of PAYMENT_ATTEMPT_STATUSES) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(isAllowedAttemptTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it.each(['CREATED', 'PENDING', 'FAILED', 'EXPIRED'] as const)(
    'F-PAY-004 refuse CONFIRMED → %s (PAYMENT_ALREADY_CONFIRMED)',
    (to) => {
      expect(codeOf(() => transitionAttempt('CONFIRMED', to, { providerTxVerified: false }))).toBe(
        'PAYMENT_ALREADY_CONFIRMED',
      );
    },
  );

  it.each([
    ['FAILED', 'PENDING'],
    ['EXPIRED', 'CONFIRMED'],
    ['REFUNDED', 'CONFIRMED'],
    ['CREATED', 'CONFIRMED'],
    ['REFUND_PENDING', 'CONFIRMED'],
  ] as const)('INT-IDEM-005 refuse %s → %s (UNAUTHORIZED_TRANSITION)', (from, to) => {
    expect(codeOf(() => transitionAttempt(from, to, { providerTxVerified: true }))).toBe(
      'UNAUTHORIZED_TRANSITION',
    );
  });

  it('CDC_05 § 5.1 refuse CONFIRMED sans provider_tx_id vérifié (PAYMENT_CONFIRMATION_UNVERIFIED)', () => {
    expect(codeOf(() => transitionAttempt('PENDING', 'CONFIRMED', { providerTxVerified: false }))).toBe(
      'PAYMENT_CONFIRMATION_UNVERIFIED',
    );
    expect(transitionAttempt('PENDING', 'CONFIRMED', { providerTxVerified: true })).toBe('CONFIRMED');
  });
});

describe('SEC-API-002 / F-PAY-003 authentification des webhooks', () => {
  const secret = randomBytes(32);
  const payload = Buffer.from('message-canonique-fourni-par-l-adaptateur', 'utf8');
  const nowMs = Date.UTC(2026, 10, 10, 12, 0, 0);
  const timestampSeconds = Math.floor(nowMs / 1000);
  const signatureHex = createHmac('sha256', secret).update(payload).digest('hex');

  it('accepte une signature HMAC-SHA256 valide dans la fenêtre', () => {
    expect(() =>
      verifyWebhookSignature({ secret, signedPayload: payload, signatureHex, timestampSeconds, nowMs }),
    ).not.toThrow();
  });

  it('fixe la fenêtre à ± 5 minutes', () => {
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
  });

  it('refuse une signature falsifiée (WEBHOOK_SIGNATURE_INVALID)', () => {
    const forged = createHmac('sha256', randomBytes(32)).update(payload).digest('hex');
    expect(
      codeOf(() =>
        verifyWebhookSignature({ secret, signedPayload: payload, signatureHex: forged, timestampSeconds, nowMs }),
      ),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('refuse un corps modifié (WEBHOOK_SIGNATURE_INVALID)', () => {
    expect(
      codeOf(() =>
        verifyWebhookSignature({
          secret,
          signedPayload: Buffer.from('message-modifie', 'utf8'),
          signatureHex,
          timestampSeconds,
          nowMs,
        }),
      ),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it.each(['', 'zz', signatureHex.slice(2), `${signatureHex}00`, signatureHex.toUpperCase()])(
    'refuse une signature mal formée (WEBHOOK_SIGNATURE_INVALID) : %s',
    (bad) => {
      expect(
        codeOf(() =>
          verifyWebhookSignature({ secret, signedPayload: payload, signatureHex: bad, timestampSeconds, nowMs }),
        ),
      ).toBe('WEBHOOK_SIGNATURE_INVALID');
    },
  );

  it.each([301, -301])('refuse un horodatage décalé de %s s (WEBHOOK_TIMESTAMP_OUT_OF_WINDOW)', (offset) => {
    expect(
      codeOf(() =>
        verifyWebhookSignature({
          secret,
          signedPayload: payload,
          signatureHex,
          timestampSeconds: timestampSeconds + offset,
          nowMs,
        }),
      ),
    ).toBe('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW');
  });

  it.each([300, -300])('accepte la borne exacte de %s s', (offset) => {
    expect(() =>
      verifyWebhookSignature({
        secret,
        signedPayload: payload,
        signatureHex,
        timestampSeconds: timestampSeconds + offset,
        nowMs,
      }),
    ).not.toThrow();
  });

  it('refuse un horodatage non entier (WEBHOOK_TIMESTAMP_OUT_OF_WINDOW)', () => {
    expect(
      codeOf(() =>
        verifyWebhookSignature({
          secret,
          signedPayload: payload,
          signatureHex,
          timestampSeconds: timestampSeconds + 0.5,
          nowMs,
        }),
      ),
    ).toBe('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW');
  });

  it('refuse un secret de moins de 32 octets (WEBHOOK_SIGNATURE_INVALID)', () => {
    const short = randomBytes(16);
    const sig = createHmac('sha256', short).update(payload).digest('hex');
    expect(
      codeOf(() =>
        verifyWebhookSignature({ secret: short, signedPayload: payload, signatureHex: sig, timestampSeconds, nowMs }),
      ),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
  });
});
