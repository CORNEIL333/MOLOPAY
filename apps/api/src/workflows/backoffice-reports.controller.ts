import { Controller, Get, Header, Inject, Query, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { computeProductKpis, type ProductKpis } from '../modules/reporting/kpi.store';
import { requiredText, whitelistedBody } from './backoffice-body';

const REASON = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]{3,500}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
/** Douala : UTC+1 toute l'année (pas d'heure d'été). */
const DOUALA_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minuit à Douala du jour donné ; date de calendrier invalide → REPORT_PERIOD_INVALID. */
export function doualaMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new BusinessError('REPORT_PERIOD_INVALID', 'Date de calendrier invalide');
  }
  return new Date(utc - DOUALA_OFFSET_MS);
}

/**
 * C24 / F-REP-002 (tranche 3) : indicateurs produits pour le back-office —
 * finance, conformité, audit (option prudente, journal C24) ; consultation
 * motivée, inscrite à l'audit chaîné dans la même transaction ; calcul en
 * lecture par `app_ro`. Période : dates de Douala, fin exclue, ≤ 366 jours.
 */
@Controller('v1/backoffice/reports')
@UseGuards(StaffSessionGuard)
export class BackofficeReportsController {
  public constructor(@Inject(PG_POOL) private readonly database: Database) {}

  @Get('product-kpis')
  @Header('Cache-Control', 'private, no-store')
  public productKpis(@CurrentStaff() staff: AdminPrincipal, @Query() query: unknown): Promise<ProductKpis> {
    const value = whitelistedBody(query, ['from', 'to', 'reason']);
    const fromText = requiredText(value['from'], DATE);
    const toText = requiredText(value['to'], DATE);
    const reason = requiredText(value['reason'], REASON).trim();
    const from = doualaMidnight(fromText);
    const to = doualaMidnight(toText);
    if (from >= to || to.getTime() - from.getTime() > MAX_DAYS * DAY_MS) {
      throw new BusinessError('REPORT_PERIOD_INVALID', `Période vide, inversée ou de plus de ${MAX_DAYS} jours`);
    }
    assertAuthorized(staff, 'READ_PRODUCT_KPIS', { reason });
    return withTransaction({ ...this.database, role: 'app_rw' }, async (client) => {
      // Calcul en lecture seule (app_ro), puis retour à app_rw pour l'inscription d'audit.
      await client.query('SET LOCAL ROLE app_ro');
      const report = await computeProductKpis(client, { from, to });
      await client.query('SET LOCAL ROLE app_rw');
      await appendAuditEvent(client, {
        eventType: 'BACKOFFICE_ACTION', actorId: staff.actorId, action: 'PRODUCT_KPIS_READ', targetType: 'BACKOFFICE_REPORT', targetId: 'product-kpis',
        outcome: 'SUCCESS', reason, refs: { from: fromText, to: toText },
      });
      return report;
    });
  }
}
