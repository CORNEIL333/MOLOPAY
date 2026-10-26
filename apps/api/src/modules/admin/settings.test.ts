import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  createApprovalRequest,
  decideApprovalRequest,
  type AdminPrincipal,
  type ApprovalRequest,
  type AuthorizationContext,
} from './domain';
import { createSettingVersion, currentSetting, type SettingVersion } from './settings';

const NOW = '2026-10-26T08:00:00.000Z';
const REQUEST_ID = '019a3000-0000-7000-8000-000000000201';
const CONTEXT: AuthorizationContext = {
  cityId: 'douala',
  partnerId: 'partner-1',
  amountXaf: 100_000n,
  reason: 'Nouveau seuil de règlement',
};
const FINANCE: AdminPrincipal = {
  actorId: 'fin-1',
  roles: ['FINANCE'],
  cityIds: ['douala'],
  maxAmountXaf: 500_000n,
};
const FINANCE_2: AdminPrincipal = {
  actorId: 'fin-2',
  roles: ['FINANCE'],
  cityIds: ['douala'],
  maxAmountXaf: 500_000n,
};

function approvedSettingRequest(
  value = '500000',
  id = REQUEST_ID,
): ApprovalRequest {
  const request = createApprovalRequest(
    {
      id,
      kind: 'FINANCIAL_SETTING',
      payload: { key: 'settlement_threshold_xaf', value },
      reason: 'Nouveau seuil de règlement',
      now: NOW,
    },
    FINANCE,
    CONTEXT,
  );
  return decideApprovalRequest(
    request,
    FINANCE_2,
    CONTEXT,
    'APPROVED',
    'Seuil validé',
    '2026-10-26T08:30:00.000Z',
  );
}

function expectInvalid(action: () => unknown): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe('ADMIN_INVALID_REQUEST');
    return;
  }
  throw new Error('Aucune erreur levée, attendu ADMIN_INVALID_REQUEST');
}

describe('paramètres versionnés', () => {
  it('publie la version 1 d’un paramètre approuvé', () => {
    const version = createSettingVersion(
      {
        key: 'settlement_threshold_xaf',
        value: '500000',
        createdAt: NOW,
        request: approvedSettingRequest(),
      },
      [],
    );
    expect(version).toMatchObject({
      key: 'settlement_threshold_xaf',
      version: 1,
      value: '500000',
      createdBy: 'fin-1',
      requestId: REQUEST_ID,
    });
  });

  it('incrémente la version et ne modifie jamais l’historique', () => {
    const first: SettingVersion = {
      key: 'settlement_threshold_xaf',
      version: 1,
      value: '500000',
      createdBy: 'fin-1',
      createdAt: NOW,
      requestId: '019a3000-0000-7000-8000-000000000202',
    };
    const second = createSettingVersion(
      {
        key: 'settlement_threshold_xaf',
        value: '600000',
        createdAt: NOW,
        request: approvedSettingRequest(
          '600000',
          '019a3000-0000-7000-8000-000000000204',
        ),
      },
      [first],
    );
    expect(second.version).toBe(2);
    expect(currentSetting([first, second], 'settlement_threshold_xaf')).toBe(
      second,
    );
    expect(currentSetting([first, second], 'other_key')).toBeNull();
  });

  it('refuse une demande non approuvée ou non financière', () => {
    const request = createApprovalRequest(
      {
        id: REQUEST_ID,
        kind: 'FINANCIAL_SETTING',
        payload: { key: 'settlement_threshold_xaf' },
        reason: 'Nouveau seuil',
        now: NOW,
      },
      FINANCE,
      CONTEXT,
    );
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: '500000',
          createdAt: NOW,
          request,
        },
        [],
      ),
    );

    const settlement = createApprovalRequest(
      {
        id: '019a3000-0000-7000-8000-000000000203',
        kind: 'SETTLEMENT',
        payload: { settlement_id: 'set-1' },
        reason: 'Règlement',
        now: NOW,
      },
      {
        actorId: 'ops-1',
        roles: ['OPERATIONS'],
        cityIds: ['douala'],
        maxAmountXaf: 500_000n,
      },
      CONTEXT,
    );
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: '500000',
          createdAt: NOW,
          request: settlement,
        },
        [],
      ),
    );
  });

  it('refuse une demande déjà publiée et une clé invalide', () => {
    const request = approvedSettingRequest();
    const existing: SettingVersion[] = [
      {
        key: 'settlement_threshold_xaf',
        version: 1,
        value: '500000',
        createdBy: 'fin-1',
        createdAt: NOW,
        requestId: REQUEST_ID,
      },
    ];
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: '500000',
          createdAt: NOW,
          request,
        },
        existing,
      ),
    );
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'Bad-Key',
          value: '1',
          createdAt: NOW,
          request,
        },
        [],
      ),
    );
  });

  it('refuse une valeur non canonisable', () => {
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: 1.5,
          createdAt: NOW,
          request: approvedSettingRequest(),
        },
        [],
      ),
    );
  });

  it('refuse une valeur ou une clé différente de la demande approuvée', () => {
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: '9000000',
          createdAt: NOW,
          request: approvedSettingRequest(),
        },
        [],
      ),
    );
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'other_threshold_xaf',
          value: '500000',
          createdAt: NOW,
          request: approvedSettingRequest(),
        },
        [],
      ),
    );
  });

  it('refuse une demande dont la charge utile a été altérée après approbation', () => {
    const tampered: ApprovalRequest = {
      ...approvedSettingRequest(),
      payload: { key: 'settlement_threshold_xaf', value: '9000000' },
    };
    expectInvalid(() =>
      createSettingVersion(
        {
          key: 'settlement_threshold_xaf',
          value: '9000000',
          createdAt: NOW,
          request: tampered,
        },
        [],
      ),
    );
  });
});
