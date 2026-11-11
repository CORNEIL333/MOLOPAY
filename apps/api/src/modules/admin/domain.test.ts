import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import { createAuditEvent, genesisAuditPrevHash } from '../audit/domain';
import {
  ADMIN_ACTIONS,
  INTERNAL_ROLES,
  approvalAuditEvent,
  authorize,
  cancelApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  type AdminAction,
  type AdminPrincipal,
  type ApprovalRequest,
  type ApprovalTransition,
  type AuthorizationContext,
  type InternalRole,
} from './domain';

const NOW = '2026-10-26T08:00:00.000Z';
const REQUEST_ID = '019a3000-0000-7000-8000-000000000001';
const AUDIT_ID = '019a3000-0000-7000-8000-000000000101';

const CONTEXT: AuthorizationContext = {
  cityId: 'douala',
  partnerId: 'partner-1',
  amountXaf: 100_000n,
  reason: 'Motif de contrôle',
};

const EXPECTED_GRANTS: Readonly<Record<InternalRole, readonly AdminAction[]>> = {
  SUPPORT_N1: [],
  SUPPORT_N2: ['READ_IDENTITY_DOCUMENT', 'READ_FINANCIAL_HISTORY'],
  OPERATIONS: [
    'READ_FINANCIAL_HISTORY',
    'PREPARE_SETTLEMENT',
    'PREPARE_LEDGER_REVERSAL',
    'DECLARE_MERCHANT_DEFAULT',
    // D49 : préparation des remboursements.
    'PREPARE_REFUND',
    // D50 : préparation des virements aux bénéficiaires C.
    'PREPARE_BENEFICIARY_PAYOUT',
  ],
  FINANCE: [
    'READ_FINANCIAL_HISTORY',
    'PREPARE_SETTLEMENT',
    'APPROVE_SETTLEMENT',
    'PREPARE_FINANCIAL_SETTING',
    'APPROVE_FINANCIAL_SETTING',
    'APPROVE_LEDGER_REVERSAL',
    // D26 (délégation du fondateur, 2026-11-10) : FINANCE prépare les plans.
    'PREPARE_PAYMENT_PLAN',
    // D49 : remboursements.
    'PREPARE_REFUND',
    'APPROVE_REFUND',
    // D50 : virements aux bénéficiaires C.
    'PREPARE_BENEFICIARY_PAYOUT',
    'APPROVE_BENEFICIARY_PAYOUT',
    // D54 : classement des écarts de rapprochement.
    'CLASSIFY_RECONCILIATION_GAP',
  ],
  COMPLIANCE: [
    'READ_IDENTITY_DOCUMENT',
    'READ_FINANCIAL_HISTORY',
    'APPROVE_PARTNER',
    'DECLARE_MERCHANT_DEFAULT',
    // D26 : COMPLIANCE approuve les plans (préparateur ≠ approbateur, I-7).
    'APPROVE_PAYMENT_PLAN',
    // D48 : examen des pièces des bénéficiaires.
    'REVIEW_BENEFICIARY_DOCUMENT',
    // D53 : décision sur une alerte de fraude.
    'DECIDE_RISK_ALERT',
  ],
  // D31 (fondateur, 2026-10-31) : déclaration de défaillance par une seule personne.
  RISK: ['READ_FINANCIAL_HISTORY', 'MANAGE_RISK_ALERT', 'DECLARE_MERCHANT_DEFAULT', 'DECIDE_RISK_ALERT'],
  PARTNER_NETWORK: ['PREPARE_PARTNER', 'DECLARE_MERCHANT_DEFAULT'],
  AUDIT: ['VIEW_AUDIT_LOG', 'EXPORT_AUDIT_LOG'],
  TECH_ADMIN: ['MANAGE_USERS', 'REQUEST_BREAK_GLASS', 'APPROVE_BREAK_GLASS'],
};

function principal(
  actorId: string,
  roles: readonly InternalRole[],
  overrides: Partial<AdminPrincipal> = {},
): AdminPrincipal {
  return {
    actorId,
    roles,
    cityIds: ['douala'],
    partnerIds: ['partner-1'],
    maxAmountXaf: 500_000n,
    ...overrides,
  };
}

const OPERATIONS = principal('ops-1', ['OPERATIONS']);
const FINANCE = principal('fin-1', ['FINANCE']);
const FINANCE_2 = principal('fin-2', ['FINANCE']);

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(BusinessError);
    expect((error as BusinessError).code).toBe(code);
    return;
  }
  throw new Error(`Aucune erreur levée, attendu ${code}`);
}

function settlementRequest(
  overrides: Partial<Parameters<typeof createApprovalRequest>[0]> = {},
): ApprovalRequest {
  return createApprovalRequest(
    {
      id: REQUEST_ID,
      kind: 'SETTLEMENT',
      payload: {
        settlement_id: 'set-1',
        amount_xaf: '100000',
        city_id: 'douala',
      },
      reason: 'Règlement du lot 42',
      now: NOW,
      ...overrides,
    },
    OPERATIONS,
    CONTEXT,
  );
}

describe('RBAC · matrice rôle × action exhaustive', () => {
  for (const role of INTERNAL_ROLES) {
    for (const action of ADMIN_ACTIONS) {
      it(`${role} × ${action}`, () => {
        const decision = authorize(principal('actor-1', [role]), action, CONTEXT);
        const expected = EXPECTED_GRANTS[role].includes(action);
        expect(decision.allowed, decision.allowed ? '' : decision.code).toBe(
          expected,
        );
      });
    }
  }

  it('refuse par défaut un acteur sans rôle', () => {
    const decision = authorize(
      { actorId: 'nobody', roles: [] },
      'READ_FINANCIAL_HISTORY',
      CONTEXT,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_FORBIDDEN' });
  });
});

describe('ABAC · périmètre, plafond et motif', () => {
  it('D31 exige un motif pour déclarer une défaillance marchand', () => {
    const decision = authorize(principal('network-1', ['PARTNER_NETWORK']), 'DECLARE_MERCHANT_DEFAULT', {
      partnerId: 'partner-1',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_REASON_REQUIRED' });
  });

  it('D31 limite la déclaration au périmètre partenaire de l’agent', () => {
    const decision = authorize(principal('network-1', ['PARTNER_NETWORK']), 'DECLARE_MERCHANT_DEFAULT', {
      ...CONTEXT,
      partnerId: 'partner-2',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_SCOPE_DENIED' });
  });

  it('refuse un partenaire hors périmètre pour le réseau partenaires', () => {
    const decision = authorize(
      principal('network-1', ['PARTNER_NETWORK']),
      'PREPARE_PARTNER',
      { ...CONTEXT, partnerId: 'partner-2' },
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_SCOPE_DENIED' });
  });

  it('applique la portée partenaire aussi à un rôle composite', () => {
    const composite = principal('comp-1', ['COMPLIANCE', 'PARTNER_NETWORK']);
    const decision = authorize(composite, 'APPROVE_PARTNER', {
      ...CONTEXT,
      partnerId: 'partner-2',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_SCOPE_DENIED' });
  });

  it('refuse une ville hors périmètre pour les opérations', () => {
    const decision = authorize(OPERATIONS, 'PREPARE_SETTLEMENT', {
      ...CONTEXT,
      cityId: 'yaounde',
    });
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_SCOPE_DENIED' });
  });

  it('refuse une approbation au-delà du plafond', () => {
    const decision = authorize(FINANCE, 'APPROVE_SETTLEMENT', {
      ...CONTEXT,
      amountXaf: 500_001n,
    });
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_AMOUNT_LIMIT' });
  });

  it('refuse une approbation sans plafond configuré', () => {
    const decision = authorize(
      { actorId: 'fin-3', roles: ['FINANCE'], cityIds: ['douala'] },
      'APPROVE_SETTLEMENT',
      CONTEXT,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'ADMIN_AMOUNT_LIMIT' });
  });

  it('exige un motif pour les lectures sensibles et l’export d’audit', () => {
    for (const action of [
      'READ_IDENTITY_DOCUMENT',
      'READ_FINANCIAL_HISTORY',
      'EXPORT_AUDIT_LOG',
    ] as const) {
      const role: InternalRole =
        action === 'EXPORT_AUDIT_LOG' ? 'AUDIT' : 'COMPLIANCE';
      const decision = authorize(principal('actor-1', [role]), action, {
        ...CONTEXT,
        reason: '   ',
      });
      expect(decision).toMatchObject({
        allowed: false,
        code: 'ADMIN_REASON_REQUIRED',
      });
    }
  });

  it('accorde une action autorisée avec un contexte complet', () => {
    expect(authorize(FINANCE, 'APPROVE_SETTLEMENT', CONTEXT)).toEqual({
      allowed: true,
    });
  });
});

describe('maker-checker · cycle de vie', () => {
  it('crée une demande en attente avec empreinte de charge utile', () => {
    const request = settlementRequest();
    expect(request.status).toBe('PENDING');
    expect(request.makerId).toBe('ops-1');
    expect(request.payloadHash).toHaveLength(32);
    expect(request.expiresAt).toBe('2026-10-27T08:00:00.000Z');
    expect(request.checkerId).toBeNull();
  });

  it('approuve avec un acteur distinct et habilité', () => {
    const request = settlementRequest();
    const approved = decideApprovalRequest(
      request,
      FINANCE,
      CONTEXT,
      'APPROVED',
      'Contrôle effectué',
      '2026-10-26T09:00:00.000Z',
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.checkerId).toBe('fin-1');
    expect(approved.decidedAt).toBe('2026-10-26T09:00:00.000Z');
    expect(approved.decisionReason).toBe('Contrôle effectué');
    expect(request.status).toBe('PENDING');
  });

  it('refuse que le préparateur approuve sa propre demande', () => {
    const selfChecker = principal('ops-1', ['OPERATIONS', 'FINANCE']);
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        selfChecker,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'MAKER_CANNOT_APPROVE');
  });

  it('refuse une approbation par un rôle non habilité', () => {
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        principal('ops-2', ['OPERATIONS']),
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_FORBIDDEN');
  });

  it('refuse une seconde décision', () => {
    const approved = decideApprovalRequest(
      settlementRequest(),
      FINANCE,
      CONTEXT,
      'APPROVED',
      undefined,
      '2026-10-26T09:00:00.000Z',
    );
    expectCode(() => {
      decideApprovalRequest(
        approved,
        FINANCE_2,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T10:00:00.000Z',
      );
    }, 'ADMIN_REQUEST_NOT_PENDING');
  });

  it('refuse une décision après expiration', () => {
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-27T08:00:00.000Z',
      );
    }, 'ADMIN_REQUEST_EXPIRED');
  });

  it('exige un motif de refus et applique le refus', () => {
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        FINANCE_2,
        CONTEXT,
        'REJECTED',
        ' ',
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_REASON_REQUIRED');
    const rejected = decideApprovalRequest(
      settlementRequest(),
      FINANCE_2,
      CONTEXT,
      'REJECTED',
      'Pièce justificative manquante',
      '2026-10-26T09:00:00.000Z',
    );
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.decisionReason).toBe('Pièce justificative manquante');
  });

  it('réserve l’annulation au préparateur, avant décision', () => {
    expectCode(() => {
      cancelApprovalRequest(
        settlementRequest(),
        FINANCE,
        '2026-10-26T08:30:00.000Z',
      );
    }, 'ADMIN_FORBIDDEN');
    const cancelled = cancelApprovalRequest(
      settlementRequest(),
      OPERATIONS,
      '2026-10-26T08:30:00.000Z',
    );
    expect(cancelled.status).toBe('CANCELLED');
    expectCode(() => {
      decideApprovalRequest(
        cancelled,
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_REQUEST_NOT_PENDING');
  });

  it('applique le plafond aussi à la décision', () => {
    const request = settlementRequest();
    const lowCeiling = principal('fin-1', ['FINANCE'], {
      maxAmountXaf: 50_000n,
    });
    expectCode(() => {
      decideApprovalRequest(
        request,
        lowCeiling,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T08:30:00.000Z',
      );
    }, 'ADMIN_AMOUNT_LIMIT');
  });

  it('refuse un contexte qui ne correspond pas à la charge approuvée', () => {
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        FINANCE,
        { ...CONTEXT, amountXaf: 200_000n },
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        FINANCE,
        { ...CONTEXT, cityId: 'yaounde' },
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_SCOPE_DENIED');
  });

  it('exige un montant déclaré pour une approbation plafonnée', () => {
    const request = settlementRequest({
      payload: { settlement_id: 'set-1' },
    });
    expectCode(() => {
      decideApprovalRequest(
        request,
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('exige la ville déclarée pour une approbation géolocalisée', () => {
    const request = settlementRequest({
      payload: { settlement_id: 'set-1', amount_xaf: '100000' },
    });
    expectCode(() => {
      decideApprovalRequest(
        request,
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('exige et lie le partenaire déclaré pour une approbation partenaire', () => {
    const network = principal('network-1', ['PARTNER_NETWORK']);
    const compliance = principal('comp-1', ['COMPLIANCE']);
    const valid = createApprovalRequest(
      {
        id: REQUEST_ID,
        kind: 'PARTNER_APPROVAL',
        payload: { partner_id: 'partner-1' },
        reason: 'Admission partenaire',
        now: NOW,
      },
      network,
      CONTEXT,
    );
    expect(
      decideApprovalRequest(
        valid,
        compliance,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      ).status,
    ).toBe('APPROVED');
    expectCode(() => {
      decideApprovalRequest(
        valid,
        compliance,
        { ...CONTEXT, partnerId: 'partner-2' },
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');

    const missing = createApprovalRequest(
      {
        id: '019a3000-0000-7000-8000-0000000002a1',
        kind: 'PARTNER_APPROVAL',
        payload: { dossier: 'partner-1' },
        reason: 'Admission partenaire',
        now: NOW,
      },
      network,
      CONTEXT,
    );
    expectCode(() => {
      decideApprovalRequest(
        missing,
        compliance,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('D26 un plan de paiement est préparé par FINANCE et approuvé par COMPLIANCE seulement', () => {
    const finance = principal('fin-1', ['FINANCE']);
    const otherFinance = principal('fin-2', ['FINANCE']);
    const compliance = principal('comp-1', ['COMPLIANCE']);
    const planInput = {
      id: REQUEST_ID,
      kind: 'PAYMENT_PLAN' as const,
      payload: { plan_id: 'plan-c-mensuel' },
      reason: 'Nouveau plan',
      now: NOW,
    };
    const request = createApprovalRequest(planInput, finance, CONTEXT);
    expect(
      decideApprovalRequest(request, compliance, CONTEXT, 'APPROVED', undefined, '2026-10-26T09:00:00.000Z').status,
    ).toBe('APPROVED');
    expectCode(() => {
      decideApprovalRequest(request, otherFinance, CONTEXT, 'APPROVED', undefined, '2026-10-26T09:00:00.000Z');
    }, 'ADMIN_FORBIDDEN');
    expectCode(() => {
      createApprovalRequest(planInput, compliance, CONTEXT);
    }, 'ADMIN_FORBIDDEN');
  });

  it('refuse un identifiant de décideur avec espaces de bord', () => {
    expectCode(() => {
      decideApprovalRequest(
        settlementRequest(),
        principal('fin-1 ', ['FINANCE']),
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('refuse une date d’expiration non valide au lieu de laisser passer', () => {
    const tampered: ApprovalRequest = {
      ...settlementRequest(),
      expiresAt: 'jamais',
    };
    expectCode(() => {
      decideApprovalRequest(
        tampered,
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('ancre la préparation et l’expiration sur l’horloge serveur', () => {
    const request = settlementRequest({ now: '2026-10-26T09:00:00.000Z' });
    expect(request.preparedAt).toBe('2026-10-26T09:00:00.000Z');
    expect(request.expiresAt).toBe('2026-10-27T09:00:00.000Z');
  });

  it('refuse un acteur de portée ville sans périmètre déclaré', () => {
    const blind: AdminPrincipal = {
      actorId: 'fin-9',
      roles: ['FINANCE'],
      maxAmountXaf: 500_000n,
    };
    expect(
      authorize(blind, 'APPROVE_SETTLEMENT', CONTEXT),
    ).toMatchObject({ allowed: false, code: 'ADMIN_SCOPE_DENIED' });
  });

  it('refuse toute décision ou annulation sur une charge utile altérée', () => {
    const tampered: ApprovalRequest = {
      ...settlementRequest(),
      payload: { settlement_id: 'set-1', amount_xaf: '900000' },
    };
    expectCode(() => {
      decideApprovalRequest(
        tampered,
        FINANCE,
        CONTEXT,
        'APPROVED',
        undefined,
        '2026-10-26T09:00:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
    expectCode(() => {
      cancelApprovalRequest(
        tampered,
        OPERATIONS,
        '2026-10-26T08:30:00.000Z',
      );
    }, 'ADMIN_INVALID_REQUEST');
  });

  it('borne le bris de glace à deux heures et exige deux administrateurs', () => {
    expectCode(() => {
      createApprovalRequest(
        {
          id: REQUEST_ID,
          kind: 'BREAK_GLASS',
          payload: { session: 'prod-1' },
          reason: 'Incident majeur',
          now: NOW,
          ttlMs: 2 * 3_600_000 + 1,
        },
        principal('tech-1', ['TECH_ADMIN']),
        { ...CONTEXT, reason: 'Incident majeur' },
      );
    }, 'ADMIN_INVALID_REQUEST');

    const request = createApprovalRequest(
      {
        id: REQUEST_ID,
        kind: 'BREAK_GLASS',
        payload: { session: 'prod-1' },
        reason: 'Incident majeur',
        now: NOW,
      },
      principal('tech-1', ['TECH_ADMIN']),
      { ...CONTEXT, reason: 'Incident majeur' },
    );
    expect(request.expiresAt).toBe('2026-10-26T10:00:00.000Z');
    const approved = decideApprovalRequest(
      request,
      principal('tech-2', ['TECH_ADMIN']),
      { ...CONTEXT, reason: 'Incident majeur' },
      'APPROVED',
      'Second administrateur',
      '2026-10-26T08:15:00.000Z',
    );
    expect(approved.status).toBe('APPROVED');
    expect(approved.checkerId).toBe('tech-2');
  });

  it('refuse une charge utile non canonisable ou un motif vide', () => {
    expectCode(() => {
      settlementRequest({ payload: { amount: 1.5 } });
    }, 'ADMIN_INVALID_REQUEST');
    expectCode(() => {
      settlementRequest({ reason: '   ' });
    }, 'ADMIN_REASON_REQUIRED');
    expectCode(() => {
      settlementRequest({ id: 'not-a-uuid' });
    }, 'ADMIN_INVALID_REQUEST');
  });
});

describe('maker-checker · preuve d’audit', () => {
  const cases: ReadonlyArray<{
    readonly transition: ApprovalTransition;
    readonly build: () => ApprovalRequest;
    readonly actor: AdminPrincipal;
  }> = [
    {
      transition: 'REQUESTED',
      build: settlementRequest,
      actor: OPERATIONS,
    },
    {
      transition: 'APPROVED',
      build: () =>
        decideApprovalRequest(
          settlementRequest(),
          FINANCE,
          CONTEXT,
          'APPROVED',
          'Contrôle effectué',
          '2026-10-26T09:00:00.000Z',
        ),
      actor: FINANCE,
    },
    {
      transition: 'REJECTED',
      build: () =>
        decideApprovalRequest(
          settlementRequest(),
          FINANCE_2,
          CONTEXT,
          'REJECTED',
          'Pièce manquante',
          '2026-10-26T09:00:00.000Z',
        ),
      actor: FINANCE_2,
    },
    {
      transition: 'CANCELLED',
      build: () =>
        cancelApprovalRequest(
          settlementRequest(),
          OPERATIONS,
          '2026-10-26T08:30:00.000Z',
        ),
      actor: OPERATIONS,
    },
  ];

  for (const testCase of cases) {
    it(`trace ${testCase.transition} sans recopier la charge utile`, () => {
      const request = testCase.build();
      const event = approvalAuditEvent(
        AUDIT_ID,
        NOW,
        request,
        testCase.transition,
        testCase.actor,
      );
      expect(event.eventType).toBe('BACKOFFICE_ACTION');
      expect(event.action).toBe(`SETTLEMENT_${testCase.transition}`);
      expect(event.actorId).toBe(testCase.actor.actorId);
      expect(event.targetType).toBe('APPROVAL_REQUEST');
      expect(event.targetId).toBe(request.id);
      expect(event.refs).toMatchObject({
        kind: 'SETTLEMENT',
        status: request.status,
        maker_id: 'ops-1',
        payload_sha256: request.payloadHash.toString('hex'),
      });
      expect(JSON.stringify(event.refs)).not.toContain('settlement_id');
      expect(() => {
        createAuditEvent(event, 1, genesisAuditPrevHash());
      }).not.toThrow();
    });
  }

  it('mappe les changements de droits et de paramètres vers leur type d’audit', () => {
    const grant = createApprovalRequest(
      {
        id: REQUEST_ID,
        kind: 'ROLE_GRANT',
        payload: { target_actor: 'fin-9', role: 'FINANCE' },
        reason: 'Arrivée dans l’équipe finance',
        now: NOW,
      },
      principal('tech-1', ['TECH_ADMIN']),
      { ...CONTEXT, reason: 'Arrivée dans l’équipe finance' },
    );
    expect(
      approvalAuditEvent(AUDIT_ID, NOW, grant, 'REQUESTED', principal('tech-1', ['TECH_ADMIN']))
        .eventType,
    ).toBe('PERMISSION_CHANGED');

    const setting = createApprovalRequest(
      {
        id: REQUEST_ID,
        kind: 'FINANCIAL_SETTING',
        payload: { key: 'settlement_threshold_xaf', value: '500000' },
        reason: 'Nouveau seuil de règlement',
        now: NOW,
      },
      FINANCE,
      { ...CONTEXT, reason: 'Nouveau seuil de règlement' },
    );
    expect(
      approvalAuditEvent(AUDIT_ID, NOW, setting, 'REQUESTED', FINANCE).eventType,
    ).toBe('CONFIG_CHANGED');
  });
});
