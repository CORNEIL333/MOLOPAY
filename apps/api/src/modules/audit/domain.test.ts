import { BusinessError } from '@achat/contracts';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  canonicalAuditContent,
  createAuditEvent,
  genesisAuditPrevHash,
  parseAuditListQuery,
  verifyAuditChain,
  type AuditEventContent,
  type AuditEventDraft,
  type AuditEventRecord,
  type AuditEventType,
} from './domain';

const ID_1 = '019a1000-0000-7000-8000-000000000001';
const ID_2 = '019a1000-0000-7000-8000-000000000002';
const ID_3 = '019a1000-0000-7000-8000-000000000003';

function draft(overrides: Partial<AuditEventDraft> = {}): AuditEventDraft {
  return {
    id: ID_1,
    ts: '2026-10-26T08:00:00.000Z',
    eventType: 'AUTH_LOGIN',
    actorId: 'admin-1',
    action: 'SESSION_OPEN',
    targetType: 'SESSION',
    targetId: 'sess-1',
    outcome: 'SUCCESS',
    refs: { ip: '203.0.113.7' },
    ...overrides,
  };
}

function sampleContent(
  overrides: Partial<AuditEventContent> = {},
): AuditEventContent {
  return {
    seq: 1,
    id: ID_1,
    ts: '2026-10-26T08:00:00.000Z',
    eventType: 'AUTH_LOGIN',
    actorId: 'admin-1',
    action: 'SESSION_OPEN',
    targetType: 'SESSION',
    targetId: 'sess-1',
    outcome: 'SUCCESS',
    reason: null,
    refs: { ip: '203.0.113.7' },
    ...overrides,
  };
}

function chainOfThree(): AuditEventRecord[] {
  const first = createAuditEvent(draft(), 1, genesisAuditPrevHash());
  const second = createAuditEvent(
    draft({
      id: ID_2,
      ts: '2026-10-26T08:01:00.000Z',
      eventType: 'BACKOFFICE_ACTION',
      action: 'PLAN_PRICE_UPDATE',
      targetType: 'PLAN',
      targetId: 'plan-1',
      refs: { plan_id: 'plan-1' },
    }),
    2,
    first.eventHash,
  );
  const third = createAuditEvent(
    draft({
      id: ID_3,
      ts: '2026-10-26T08:02:00.000Z',
      eventType: 'SENSITIVE_DATA_READ',
      action: 'READ_FINANCIAL_HISTORY',
      targetType: 'CLIENT',
      targetId: 'client-1',
      reason: 'Demande du client au guichet',
      refs: { client_id: 'client-1' },
    }),
    3,
    second.eventHash,
  );
  return [first, second, third];
}

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

describe('journal d’audit chaîné · contenu canonique', () => {
  it('produit un contenu JCS déterministe et ordonné', () => {
    const canonical = canonicalAuditContent(sampleContent());
    expect(canonical).toBe(
      '{"action":"SESSION_OPEN","actor_id":"admin-1","event_type":"AUTH_LOGIN","id":"019a1000-0000-7000-8000-000000000001","outcome":"SUCCESS","reason":null,"refs":{"ip":"203.0.113.7"},"seq":1,"target_id":"sess-1","target_type":"SESSION","ts":"2026-10-26T08:00:00.000Z"}',
    );
    expect(canonicalAuditContent(sampleContent())).toBe(canonical);
  });

  it('lie l’empreinte au prev_hash et à chaque champ', () => {
    const first = createAuditEvent(draft(), 1, genesisAuditPrevHash());
    expect(first.prevHash.equals(genesisAuditPrevHash())).toBe(true);
    expect(first.eventHash).toHaveLength(32);

    const second = createAuditEvent(
      draft({ id: ID_2 }),
      2,
      first.eventHash,
    );
    expect(second.eventHash.equals(first.eventHash)).toBe(false);

    const altered = createAuditEvent(
      draft({ id: ID_2, action: 'SESSION_CLOSE' }),
      2,
      first.eventHash,
    );
    expect(altered.eventHash.equals(second.eventHash)).toBe(false);
  });
});

describe('journal d’audit chaîné · validation', () => {
  it('accepte une chaîne contiguë et vérifiable', () => {
    expect(() => {
      verifyAuditChain(chainOfThree());
    }).not.toThrow();
  });

  it('accepte un journal vide (aucun événement)', () => {
    expect(() => {
      verifyAuditChain([]);
    }).not.toThrow();
  });

  it('refuse une séquence avec trou', () => {
    const records = chainOfThree();
    const first = records[0];
    const third = records[2];
    if (first === undefined || third === undefined) {
      throw new Error('Chaîne de test incomplète');
    }
    expectCode(() => {
      verifyAuditChain([first, third]);
    }, 'AUDIT_SEQUENCE_GAP');
  });

  it('refuse un prev_hash rompu', () => {
    const records = chainOfThree();
    const second = records[1];
    if (second === undefined) {
      throw new Error('Chaîne de test incomplète');
    }
    const broken: AuditEventRecord = {
      ...second,
      prevHash: Buffer.alloc(32, 1),
    };
    expectCode(() => {
      verifyAuditChain([records[0] as AuditEventRecord, broken]);
    }, 'AUDIT_CHAIN_BROKEN');
  });

  it('refuse un contenu altéré après coup', () => {
    const records = chainOfThree();
    const second = records[1];
    if (second === undefined) {
      throw new Error('Chaîne de test incomplète');
    }
    const tampered: AuditEventRecord = { ...second, action: 'PLAN_DELETE' };
    const first = records[0];
    if (first === undefined) {
      throw new Error('Chaîne de test incomplète');
    }
    expectCode(() => {
      verifyAuditChain([first, tampered]);
    }, 'AUDIT_CHAIN_BROKEN');
  });

  it('refuse un identifiant dupliqué', () => {
    const first = createAuditEvent(draft(), 1, genesisAuditPrevHash());
    const duplicate = createAuditEvent(
      draft({ ts: '2026-10-26T08:01:00.000Z' }),
      2,
      first.eventHash,
    );
    expectCode(() => {
      verifyAuditChain([first, duplicate]);
    }, 'AUDIT_INVALID_EVENT');
  });

  it('exige un motif pour toute lecture de données sensibles', () => {
    expectCode(() => {
      createAuditEvent(
        draft({
          eventType: 'SENSITIVE_DATA_READ',
          action: 'READ_IDENTITY_DOCUMENT',
          reason: '   ',
        }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_REASON_REQUIRED');
    expectCode(() => {
      createAuditEvent(
        draft({
          eventType: 'SENSITIVE_DATA_READ',
          action: 'READ_IDENTITY_DOCUMENT',
        }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_REASON_REQUIRED');
  });

  it('accepte un motif pour un événement ordinaire et le canonicalise', () => {
    const event = createAuditEvent(
      draft({ reason: 'Maintenance planifiée' }),
      1,
      genesisAuditPrevHash(),
    );
    expect(event.reason).toBe('Maintenance planifiée');
    expect(canonicalAuditContent(event)).toContain(
      '"reason":"Maintenance planifiée"',
    );
  });

  it('refuse les métadonnées sensibles, y compris imbriquées', () => {
    expectCode(() => {
      createAuditEvent(
        draft({ refs: { password: 'secret' } }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_SENSITIVE_METADATA');
    expectCode(() => {
      createAuditEvent(
        draft({ refs: { request: { headers: { Authorization: 'Bearer x' } } } }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_SENSITIVE_METADATA');
    expectCode(() => {
      createAuditEvent(
        draft({ refs: { documents: [{ document_number: 'CNI-1' }] } }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_SENSITIVE_METADATA');
  });

  it('refuse les clés composées qui masquent un secret', () => {
    for (const key of [
      'client_pin',
      'clientPin',
      'pin_code',
      'newPIN',
      'pin_hash',
      'otp_code',
      'code_hash',
      'auth_token',
      'token_hash',
      'new_password',
      'api_key',
      'private_key',
      'otp_mac',
      'recovery_code',
    ]) {
      expectCode(() => {
        createAuditEvent(
          draft({ refs: { [key]: '1234' } }),
          1,
          genesisAuditPrevHash(),
        );
      }, 'AUDIT_SENSITIVE_METADATA');
    }
  });

  it('refuse une clé de métadonnée hors du jeu autorisé', () => {
    for (const key of ['clé', 'pin code', 'pin:code', 'pin/code']) {
      expectCode(() => {
        createAuditEvent(
          draft({ refs: { [key]: 'x' } }),
          1,
          genesisAuditPrevHash(),
        );
      }, 'AUDIT_INVALID_EVENT');
    }
  });

  it('refuse un type d’événement non déclaré', () => {
    expectCode(() => {
      createAuditEvent(
        draft({ eventType: 'USER_DELETED' as AuditEventType }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_INVALID_EVENT');
  });

  it('refuse les flottants et les champs vides', () => {
    expectCode(() => {
      createAuditEvent(
        draft({ refs: { amount: 1.5 } }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      createAuditEvent(draft({ actorId: ' ' }), 1, genesisAuditPrevHash());
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      createAuditEvent(
        draft({ ts: '2026-10-26T08:00:00Z' }),
        1,
        genesisAuditPrevHash(),
      );
    }, 'AUDIT_INVALID_EVENT');
  });

  it('refuse un prev_hash de taille incorrecte', () => {
    expectCode(() => {
      createAuditEvent(draft(), 1, Buffer.alloc(31));
    }, 'AUDIT_INVALID_EVENT');
  });
});

describe('journal d’audit chaîné · lecture paginée', () => {
  it('applique les valeurs par défaut', () => {
    expect(parseAuditListQuery({})).toEqual({
      afterSeq: null,
      limit: AUDIT_DEFAULT_LIMIT,
      actorId: null,
      targetId: null,
      eventType: null,
    });
  });

  it('accepte les filtres déclarés', () => {
    expect(
      parseAuditListQuery({
        afterSeq: '12',
        limit: '25',
        actorId: ' admin-1 ',
        targetId: 'client-1',
        eventType: 'SENSITIVE_DATA_READ',
      }),
    ).toEqual({
      afterSeq: 12,
      limit: 25,
      actorId: 'admin-1',
      targetId: 'client-1',
      eventType: 'SENSITIVE_DATA_READ',
    });
  });

  it('refuse les bornes et filtres invalides', () => {
    expectCode(() => {
      parseAuditListQuery({ limit: '0' });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ limit: String(AUDIT_MAX_LIMIT + 1) });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ afterSeq: '-1' });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ eventType: 'USER_DELETED' });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ actorId: ['a', 'b'] });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ targetId: '   ' });
    }, 'AUDIT_INVALID_EVENT');
    expectCode(() => {
      parseAuditListQuery({ afterSeq: '1', admin: 'true' });
    }, 'AUDIT_INVALID_EVENT');
  });
});
