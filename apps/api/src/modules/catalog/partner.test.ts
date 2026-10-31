import { createHash } from 'node:crypto';
import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  createPartnerDossier,
  partnerDossierHash,
  partnerFromValidation,
  validatePartner,
  type PartnerApprovalDecision,
  type PartnerDossier,
  type PartnerDossierInput,
} from './partner';

const REQUEST_ID = '019a9000-0000-7000-8000-0000000000a1';
const NOW = '2026-10-27T10:00:00.000Z';

const INPUT: PartnerDossierInput = {
  partnerId: 'partner-1',
  partnerType: 'MERCHANT',
  beneficiaryKind: null,
  legalName: 'Électro Douala SARL',
  rccm: 'RC/DLA/2024/B/0001',
  niu: 'M000000000000A',
  representativeDocumentRef: 'kyc-doc-ref-0001',
  settlementAccountRef: 'settlement-ref-0001',
};

function dossier(overrides: Partial<PartnerDossierInput> = {}): PartnerDossier {
  return createPartnerDossier({ ...INPUT, ...overrides });
}

function decision(
  target: PartnerDossier,
  overrides: Partial<PartnerApprovalDecision> = {},
  payloadOverride?: Readonly<Record<string, JsonValue>>,
): PartnerApprovalDecision {
  const payload = payloadOverride ?? {
    partner_id: target.partnerId,
    dossier_hash: partnerDossierHash(target).toString('hex'),
  };
  return {
    id: REQUEST_ID,
    kind: 'PARTNER_APPROVAL',
    status: 'APPROVED',
    makerId: 'maker-1',
    checkerId: 'checker-1',
    payload,
    payloadHash: createHash('sha256').update(canonicalize(payload), 'utf8').digest(),
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe(code);
    return;
  }
  throw new Error(`Aucune erreur levée, ${code} attendu`);
}

describe('F-PRT-001 · dossier partenaire', () => {
  it('F-PRT-001 accepte un dossier complet et le fige', () => {
    const value = dossier();
    expect(value).toEqual(INPUT);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it.each([
    'partnerId',
    'legalName',
    'rccm',
    'niu',
    'representativeDocumentRef',
    'settlementAccountRef',
  ] as const)('F-PRT-001 refuse un dossier sans %s', (field) => {
    expectCode(() => dossier({ [field]: '' }), 'CATALOG_INVALID_REQUEST');
    expectCode(() => dossier({ [field]: '   ' }), 'CATALOG_INVALID_REQUEST');
  });

  it('F-PRT-001 refuse un champ supplémentaire (liste blanche)', () => {
    expectCode(
      () =>
        createPartnerDossier({
          ...INPUT,
          representativeDocumentContent: 'base64…',
        } as PartnerDossierInput),
      'CATALOG_FIELD_FORBIDDEN',
    );
  });

  it('F-PRT-001 refuse des références contenant des espaces', () => {
    expectCode(
      () => dossier({ representativeDocumentRef: 'ref avec espace' }),
      'CATALOG_INVALID_REQUEST',
    );
  });

  it('F-PRT-001 l’empreinte change dès qu’un champ change', () => {
    const a = partnerDossierHash(dossier());
    const b = partnerDossierHash(dossier({ settlementAccountRef: 'settlement-ref-0002' }));
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
    expect(a.equals(partnerDossierHash(dossier()))).toBe(true);
  });
});

describe('F-PRT-001 · validation maker-checker', () => {
  it('F-PRT-001 valide un partenaire sur décision approuvée du dossier exact', () => {
    const target = dossier();
    const validation = validatePartner({
      dossier: target,
      decision: decision(target),
      validatedAt: NOW,
    });
    expect(validation).toEqual({
      partnerId: 'partner-1',
      dossierHash: partnerDossierHash(target).toString('hex'),
      requestId: REQUEST_ID,
      validatedAt: NOW,
    });
    expect(partnerFromValidation('partner-1', validation)).toEqual({
      id: 'partner-1',
      status: 'VALIDATED',
    });
  });

  it('F-PRT-001 un partenaire sans validation reste PENDING (invisible)', () => {
    expect(partnerFromValidation('partner-1', null)).toEqual({
      id: 'partner-1',
      status: 'PENDING',
    });
  });

  it('F-PRT-001 refuse une validation d’un autre partenaire', () => {
    const target = dossier();
    const validation = validatePartner({
      dossier: target,
      decision: decision(target),
      validatedAt: NOW,
    });
    expectCode(
      () => partnerFromValidation('partner-2', validation),
      'CATALOG_INVALID_REQUEST',
    );
  });

  it.each(['PENDING', 'REJECTED', 'CANCELLED', 'EXPIRED'] as const)(
    'F-PRT-001 refuse une demande %s',
    (status) => {
      const target = dossier();
      expectCode(
        () =>
          validatePartner({
            dossier: target,
            decision: decision(target, { status }),
            validatedAt: NOW,
          }),
        'CATALOG_PARTNER_NOT_VALIDATED',
      );
    },
  );

  it('F-PRT-001 refuse une demande d’un autre type', () => {
    const target = dossier();
    expectCode(
      () =>
        validatePartner({
          dossier: target,
          decision: decision(target, { kind: 'FINANCIAL_SETTING' }),
          validatedAt: NOW,
        }),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
  });

  it('SEC-AUTHZ-003 refuse une décision où préparateur = approbateur', () => {
    const target = dossier();
    expectCode(
      () =>
        validatePartner({
          dossier: target,
          decision: decision(target, { checkerId: 'maker-1' }),
          validatedAt: NOW,
        }),
      'MAKER_CANNOT_APPROVE',
    );
  });

  it('F-PRT-001 refuse un dossier modifié après approbation', () => {
    const approved = dossier();
    const changed = dossier({ settlementAccountRef: 'settlement-ref-pirate' });
    expectCode(
      () =>
        validatePartner({
          dossier: changed,
          decision: decision(approved),
          validatedAt: NOW,
        }),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
  });

  it('F-PRT-001 refuse une approbation portant sur un autre partenaire', () => {
    const target = dossier();
    const other = dossier({ partnerId: 'partner-2' });
    expectCode(
      () =>
        validatePartner({
          dossier: target,
          decision: decision(other),
          validatedAt: NOW,
        }),
      'CATALOG_PARTNER_NOT_VALIDATED',
    );
  });

  it('F-PRT-001 refuse une charge approuvée altérée', () => {
    const target = dossier();
    const genuine = decision(target);
    const forged: PartnerApprovalDecision = {
      ...genuine,
      payload: { ...genuine.payload, partner_id: 'partner-1 ' },
    };
    expectCode(
      () => validatePartner({ dossier: target, decision: forged, validatedAt: NOW }),
      'CATALOG_INVALID_REQUEST',
    );
  });

  it('F-PRT-001 refuse une charge approuvée avec un champ hors liste blanche', () => {
    const target = dossier();
    expectCode(
      () =>
        validatePartner({
          dossier: target,
          decision: decision(target, {}, {
            partner_id: target.partnerId,
            dossier_hash: partnerDossierHash(target).toString('hex'),
            status_override: 'VALIDATED',
          }),
          validatedAt: NOW,
        }),
      'CATALOG_FIELD_FORBIDDEN',
    );
  });

  it('F-PRT-001 refuse un horodatage non ISO UTC', () => {
    const target = dossier();
    expectCode(
      () =>
        validatePartner({
          dossier: target,
          decision: decision(target),
          validatedAt: '2026-10-27 10:00',
        }),
      'CATALOG_INVALID_REQUEST',
    );
  });
});

describe('F-PLN-001 · CDC_05 · type de partenaire', () => {
  it('F-PLN-001 accepte un bénéficiaire avec sa catégorie', () => {
    const landlord = dossier({ partnerType: 'BENEFICIARY', beneficiaryKind: 'LANDLORD' });
    expect(landlord.partnerType).toBe('BENEFICIARY');
    expect(landlord.beneficiaryKind).toBe('LANDLORD');
  });

  it.each([
    ['un bénéficiaire sans catégorie', { partnerType: 'BENEFICIARY', beneficiaryKind: null }],
    ['un marchand avec catégorie', { partnerType: 'MERCHANT', beneficiaryKind: 'SCHOOL' }],
    ['une catégorie inconnue', { partnerType: 'BENEFICIARY', beneficiaryKind: 'CHURCH' }],
    ['un type inconnu', { partnerType: 'LENDER', beneficiaryKind: null }],
  ])('F-PLN-001 refuse %s → CATALOG_INVALID_REQUEST', (_label, overrides) => {
    expect(() => dossier(overrides as Partial<PartnerDossierInput>)).toThrowError(
      expect.objectContaining({ code: 'CATALOG_INVALID_REQUEST' }),
    );
  });

  it('SEC-AUTHZ-003 le type entre dans l’empreinte approuvée', () => {
    const merchant = partnerDossierHash(dossier());
    const beneficiary = partnerDossierHash(
      dossier({ partnerType: 'BENEFICIARY', beneficiaryKind: 'AGENCY' }),
    );
    const otherKind = partnerDossierHash(
      dossier({ partnerType: 'BENEFICIARY', beneficiaryKind: 'SCHOOL' }),
    );
    expect(merchant.equals(beneficiary)).toBe(false);
    expect(beneficiary.equals(otherKind)).toBe(false);
  });
});
