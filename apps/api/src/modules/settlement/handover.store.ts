import { BusinessError } from '@achat/contracts';
import { xaf } from '@achat/money';
import type { PoolClient } from 'pg';
import { appendAgreementTransition, getAgreement } from '../agreements/agreement.store';
import { uuidv7 } from '../ledger/domain';
import { appendLedgerEntry, ensureClientFundsAccount, ensurePartnerFundsAccount } from '../ledger/entry.store';
import { generateHandoverCode, handoverCodeMac, normalizeHandoverCode } from './handover-code';

type SqlClient = Pick<PoolClient, 'query'>;

const ACTOR_PATTERN = /^[^\s]{1,200}$/;
const PARTNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const COORDINATE_PATTERN = /^-?\d{1,3}(\.\d{1,6})?$/;
const CODE_ATTEMPTS = 3;

function invalid(message: string): never {
  throw new BusinessError('SETTLEMENT_INVALID_REQUEST', message);
}

function coordinate(value: string, limit: number, field: string): string {
  if (!COORDINATE_PATTERN.test(value) || Math.abs(Number(value)) > limit) {
    invalid(`${field} invalide`);
  }
  return value;
}

/**
 * F-SAV-004 : émet le code de remise d'un accord A financé à 100 %. Le code
 * en clair n'est renvoyé qu'ici, une seule fois ; la base n'en garde que
 * l'empreinte et fixe l'échéance d'après le paramètre publié (D45).
 */
export async function issueHandoverCode(
  client: SqlClient,
  input: { readonly agreementId: string; readonly pepper: Uint8Array; readonly actorId: string },
): Promise<{ readonly code: string; readonly expiresAt: string }> {
  if (!ACTOR_PATTERN.test(input.actorId)) {
    invalid('acteur invalide');
  }
  for (let attempt = 1; ; attempt += 1) {
    const code = generateHandoverCode();
    const result = await client.query<{ expires_at: Date }>(
      `INSERT INTO settlement.handover_code (agreement_id, seq, code_mac, issued_at, expires_at)
       VALUES ($1, 1, $2, now(), now() + interval '1 day')
       ON CONFLICT (code_mac) DO NOTHING
       RETURNING expires_at`,
      [input.agreementId, handoverCodeMac(input.pepper, code)],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return Object.freeze({ code, expiresAt: row.expires_at.toISOString() });
    }
    if (attempt >= CODE_ATTEMPTS) {
      invalid('code de remise indisponible');
    }
  }
}

/**
 * F-SET-001 : remise prouvée par le code saisi par le marchand, avec
 * géolocalisation. Dans la même transaction : écriture HANDOVER (débit 2100
 * du client, crédit 2200 du marchand, prix figé), remise, FUNDED → HANDED_OVER.
 * `partnerLedgerOwnerId` vient du catalogue (D42), lu par le flux appelant ;
 * la base vérifie qu'il est bien celui du partenaire.
 */
export async function confirmHandover(
  client: SqlClient,
  input: {
    readonly code: string;
    readonly partnerId: string;
    readonly partnerLedgerOwnerId: string;
    readonly partnerUserId: string;
    readonly latitude: string;
    readonly longitude: string;
    readonly pepper: Uint8Array;
  },
): Promise<{ readonly agreementId: string; readonly entryId: string }> {
  if (!PARTNER_PATTERN.test(input.partnerId) || !ACTOR_PATTERN.test(input.partnerUserId)) {
    invalid('partenaire ou vendeur invalide');
  }
  const latitude = coordinate(input.latitude, 90, 'latitude');
  const longitude = coordinate(input.longitude, 180, 'longitude');
  const code = normalizeHandoverCode(input.code);
  const found = await client.query<{ agreement_id: string; seq: number; expired: boolean }>(
    `SELECT agreement_id, seq, expires_at <= clock_timestamp() AS expired
       FROM settlement.handover_code WHERE code_mac = $1`,
    [handoverCodeMac(input.pepper, code)],
  );
  const issued = found.rows[0];
  const stored = issued === undefined ? null : await getAgreement(client, issued.agreement_id);
  // Code inconnu et code d'un autre marchand : même réponse (aucun oracle).
  if (issued === undefined || stored === null || stored.agreement.terms.partnerId !== input.partnerId) {
    throw new BusinessError('HANDOVER_CODE_INVALID', 'code de remise invalide');
  }
  const used = await client.query('SELECT 1 FROM settlement.handover WHERE agreement_id = $1', [issued.agreement_id]);
  if ((used.rowCount ?? 0) > 0) {
    throw new BusinessError('HANDOVER_CODE_USED', 'code de remise déjà utilisé');
  }
  if (issued.expired) {
    throw new BusinessError('HANDOVER_CODE_EXPIRED', 'code de remise expiré');
  }
  if (stored.agreement.status !== 'FUNDED') {
    throw new BusinessError('HANDOVER_NOT_ALLOWED', `accord à l’état ${stored.agreement.status}`);
  }
  const amount = xaf(stored.agreement.terms.targetXaf);
  const clientAccount = await ensureClientFundsAccount(client, stored.agreement.terms.customerId);
  const partnerAccount = await ensurePartnerFundsAccount(client, input.partnerLedgerOwnerId);
  const entry = await appendLedgerEntry(client, {
    id: uuidv7(),
    operationType: 'HANDOVER',
    businessRefs: { agreement_id: issued.agreement_id, partner_id: input.partnerId },
    actorId: input.partnerUserId,
    approvers: [],
    idemScope: 'settlement.handover',
    idemKey: issued.agreement_id,
    postings: [
      { accountId: clientAccount, direction: 'DEBIT', amount },
      { accountId: partnerAccount, direction: 'CREDIT', amount },
    ],
  });
  if (entry.replayed) {
    throw new BusinessError('HANDOVER_CODE_USED', 'code de remise déjà utilisé');
  }
  await client.query(
    `INSERT INTO settlement.handover
       (agreement_id, code_seq, partner_id, partner_user_id, latitude, longitude, entry_id, used_at)
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, now())`,
    [issued.agreement_id, issued.seq, input.partnerId, input.partnerUserId, latitude, longitude, entry.id],
  );
  await appendAgreementTransition(client, {
    agreementId: issued.agreement_id,
    to: 'HANDED_OVER',
    actorId: input.partnerUserId,
  });
  return Object.freeze({ agreementId: issued.agreement_id, entryId: entry.id });
}
