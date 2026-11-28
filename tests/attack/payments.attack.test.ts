import { createHmac, randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusinessError } from '../../packages/contracts/src/errors';
import {
  PAYMENT_ATTEMPT_STATUSES,
  WEBHOOK_TOLERANCE_SECONDS,
  transitionAttempt,
  verifyWebhookSignature,
  type PaymentAttemptStatus,
} from '../../apps/api/src/modules/payments/domain';

// CDC_07 § 3, lot 11 : rejeu, désordre, falsification. Les attaques qui
// exigent la base (nonce rejoué, confirmation dupliquée, identifiant de
// transaction réutilisé) sont dans apps/api/test/db/payments.db.test.ts.

const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

function codeOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error: unknown) {
    if (error instanceof BusinessError) {
      return error.code;
    }
    throw error;
  }
}

describe('ATK-PAY falsification de webhook (SEC-API-002)', () => {
  const secret = randomBytes(32);

  it('toute altération d’un octet du message signé est refusée', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (bytes, position, flip) => {
          const payload = Buffer.from(bytes);
          const signatureHex = createHmac('sha256', secret).update(payload).digest('hex');
          const tampered = Buffer.from(payload);
          const index = position % tampered.length;
          tampered[index] = (tampered[index] ?? 0) ^ flip;
          expect(
            codeOf(() =>
              verifyWebhookSignature({
                secret,
                signedPayload: tampered,
                signatureHex,
                timestampSeconds: NOW_S,
                nowMs: NOW_MS,
              }),
            ),
          ).toBe('WEBHOOK_SIGNATURE_INVALID');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('toute altération de la signature est refusée', () => {
    const payload = Buffer.from('corps-de-webhook', 'utf8');
    const good = createHmac('sha256', secret).update(payload).digest();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 31 }), fc.integer({ min: 1, max: 255 }), (index, flip) => {
        const forged = Buffer.from(good);
        forged[index] = (forged[index] ?? 0) ^ flip;
        expect(
          codeOf(() =>
            verifyWebhookSignature({
              secret,
              signedPayload: payload,
              signatureHex: forged.toString('hex'),
              timestampSeconds: NOW_S,
              nowMs: NOW_MS,
            }),
          ),
        ).toBe('WEBHOOK_SIGNATURE_INVALID');
      }),
      { numRuns: 500 },
    );
  });

  it('une signature faite avec un autre secret est refusée', () => {
    const payload = Buffer.from('corps-de-webhook', 'utf8');
    const attacker = randomBytes(32);
    const signatureHex = createHmac('sha256', attacker).update(payload).digest('hex');
    expect(
      codeOf(() =>
        verifyWebhookSignature({ secret, signedPayload: payload, signatureHex, timestampSeconds: NOW_S, nowMs: NOW_MS }),
      ),
    ).toBe('WEBHOOK_SIGNATURE_INVALID');
  });
});

describe('ATK-PAY rejeu tardif de webhook (SEC-API-002)', () => {
  const secret = randomBytes(32);
  const payload = Buffer.from('corps-de-webhook', 'utf8');
  const signatureHex = createHmac('sha256', secret).update(payload).digest('hex');

  it('un webhook valide rejoué hors fenêtre est refusé, même correctement signé', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: WEBHOOK_TOLERANCE_SECONDS + 1, max: 10 * 365 * 86_400 }),
        fc.boolean(),
        (delay, future) => {
          const timestampSeconds = future ? NOW_S + delay : NOW_S - delay;
          expect(
            codeOf(() =>
              verifyWebhookSignature({ secret, signedPayload: payload, signatureHex, timestampSeconds, nowMs: NOW_MS }),
            ),
          ).toBe('WEBHOOK_TIMESTAMP_OUT_OF_WINDOW');
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('ATK-PAY messages désordonnés (F-PAY-004, INT-IDEM-005)', () => {
  const PAID: readonly PaymentAttemptStatus[] = ['CONFIRMED', 'REFUND_PENDING', 'REFUNDED'];

  it('aucune suite de messages ne ramène un paiement confirmé à un état non payé', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...PAYMENT_ATTEMPT_STATUSES), { maxLength: 40 }), (messages) => {
        let status: PaymentAttemptStatus = 'CREATED';
        let wasConfirmed = false;
        for (const next of messages) {
          try {
            status = transitionAttempt(status, next, { providerTxVerified: true });
          } catch (error: unknown) {
            if (!(error instanceof BusinessError)) {
              throw error;
            }
            if (status === 'CONFIRMED') {
              expect(error.code).toBe('PAYMENT_ALREADY_CONFIRMED');
            }
          }
          wasConfirmed ||= status === 'CONFIRMED';
          if (wasConfirmed) {
            expect(PAID).toContain(status);
          }
        }
      }),
      { numRuns: 2_000 },
    );
  });

  it('un état terminal (FAILED, EXPIRED, REFUNDED) ne bouge plus', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<PaymentAttemptStatus>('FAILED', 'EXPIRED', 'REFUNDED'),
        fc.constantFrom(...PAYMENT_ATTEMPT_STATUSES),
        (terminal, next) => {
          expect(codeOf(() => transitionAttempt(terminal, next, { providerTxVerified: true }))).toBe(
            'UNAUTHORIZED_TRANSITION',
          );
        },
      ),
    );
  });

  it('une confirmation non vérifiée auprès du prestataire est toujours refusée', () => {
    expect(codeOf(() => transitionAttempt('PENDING', 'CONFIRMED', { providerTxVerified: false }))).toBe(
      'PAYMENT_CONFIRMATION_UNVERIFIED',
    );
  });
});
