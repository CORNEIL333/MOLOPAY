import { BusinessError } from '@achat/contracts';
import type { PoolClient } from 'pg';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { getLatestSettingValue } from '../modules/admin/setting.store';
import { listCustomerCancellationsSince } from '../modules/agreements/risk-facts.store';
import { uuidv7 } from '../modules/ledger/domain';
import { listConfirmedContributionsSince } from '../modules/payments/risk-facts.store';
import { getAlert, recordAlert, recordAlertDecision, type SubjectType } from '../modules/risk/alert.store';
import { evaluateRule, parseRiskThresholds, type RiskEvent, type RiskRule } from '../modules/risk/domain';
import { listHandoversSince } from '../modules/settlement/risk-facts.store';

type SqlClient = Pick<PoolClient, 'query'>;

export const RISK_THRESHOLDS_KEY = 'risk_rule_thresholds';

function groupBy<T>(items: readonly T[], subject: (item: T) => string, event: (item: T) => RiskEvent): Map<string, RiskEvent[]> {
  const groups = new Map<string, RiskEvent[]>();
  for (const item of items) {
    const key = subject(item);
    groups.set(key, [...(groups.get(key) ?? []), event(item)]);
  }
  return groups;
}

/**
 * SEC-FRD-001 / D53 : passe de détection. Lit les seuils publiés (fermé par
 * défaut), les faits de chaque module dans la plus longue fenêtre utile,
 * évalue les règles pures et écrit une alerte par sujet en dépassement, sauf
 * alerte déjà ouverte. Aucune sanction (SEC-FRD-002).
 */
export async function runRiskDetection(
  client: SqlClient,
  input: { readonly now: Date; readonly actorId: string },
): Promise<{ readonly created: number; readonly alreadyOpen: number }> {
  const thresholds = parseRiskThresholds(await getLatestSettingValue(client, RISK_THRESHOLDS_KEY));
  const now = input.now.getTime();
  const since = (rule: RiskRule): Date => new Date(now - thresholds[rule].windowMinutes * 60_000);

  const subjects: { readonly rule: RiskRule; readonly subjectType: SubjectType; readonly groups: Map<string, RiskEvent[]> }[] = [
    {
      rule: 'PAYMENT_VELOCITY',
      subjectType: 'CUSTOMER',
      groups: groupBy(
        await listConfirmedContributionsSince(client, since('PAYMENT_VELOCITY')),
        (fact) => fact.customerId,
        (fact) => ({ id: fact.contributionId, at: fact.confirmedAt.getTime() }),
      ),
    },
    {
      rule: 'REPEATED_CANCELLATIONS',
      subjectType: 'CUSTOMER',
      groups: groupBy(
        await listCustomerCancellationsSince(client, since('REPEATED_CANCELLATIONS')),
        (fact) => fact.customerId,
        (fact) => ({ id: fact.agreementId, at: fact.cancelledAt.getTime() }),
      ),
    },
    {
      rule: 'HANDOVER_SPIKE',
      subjectType: 'PARTNER',
      groups: groupBy(
        await listHandoversSince(client, since('HANDOVER_SPIKE')),
        (fact) => fact.partnerId,
        (fact) => ({ id: fact.agreementId, at: fact.usedAt.getTime() }),
      ),
    },
  ];

  let created = 0;
  let alreadyOpen = 0;
  for (const { rule, subjectType, groups } of subjects) {
    for (const [subjectId, events] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const finding = evaluateRule({ rule, thresholds, events, now });
      if (finding === null) {
        continue;
      }
      const outcome = await recordAlert(client, { id: uuidv7(), finding, subjectType, subjectId, actorId: input.actorId });
      if (outcome === 'CREATED') {
        created += 1;
      } else {
        alreadyOpen += 1;
      }
    }
  }
  return Object.freeze({ created, alreadyOpen });
}

/** SEC-FRD-002 / D53 : décision tracée par Risque ou Conformité (DECIDE_RISK_ALERT). */
export async function decideRiskAlert(
  client: SqlClient,
  input: { readonly alertId: string; readonly principal: AdminPrincipal; readonly decision: 'DISMISSED' | 'CONFIRMED'; readonly reason: string },
): Promise<void> {
  assertAuthorized(input.principal, 'DECIDE_RISK_ALERT', {});
  const alert = await getAlert(client, input.alertId);
  if (alert === null) {
    throw new BusinessError('RISK_ALERT_NOT_FOUND', 'alerte introuvable');
  }
  await recordAlertDecision(client, { alert, decision: input.decision, reason: input.reason, actorId: input.principal.actorId });
}
