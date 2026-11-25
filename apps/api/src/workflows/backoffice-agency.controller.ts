import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CurrentStaff, StaffSessionGuard } from '../http/staff-session.guard';
import { assertAuthorized, type AdminPrincipal } from '../modules/admin/domain';
import { appendAuditEvent } from '../modules/audit/audit.store';
import { issueAgencySignupCode, type AgencyDocumentType } from '../modules/identity/agency-enrollment.store';
import { normalizePhone } from '../modules/identity/domain';
import { PII_KEYS, protectPhone, type PiiKeys } from '../modules/identity/phone-key';
import { OTP_PEPPER } from '../modules/identity/sms.port';
import { oneOf, whitelistedBody } from './backoffice-body';

const DOCUMENTS: readonly AgencyDocumentType[] = ['CNI', 'PASSPORT', 'RESIDENCE_PERMIT'];
const CITIES = ['yaounde', 'douala'] as const;

/**
 * C13 / F-ACC-001 (décision du fondateur du 24 novembre) : inscription en
 * agence sans SMS. L'agent du support, dans sa ville, vérifie en personne la
 * pièce d'identité et le téléphone du client, puis émet un code d'inscription
 * qu'il lui remet ; le client termine sur son appareil (`POST /v1/auth/signups`).
 * Le code n'est rendu qu'à la première exécution (jamais conservé en clair,
 * jamais rejoué) ; l'émission est inscrite à l'audit chaîné, sans le numéro.
 */
@Controller('v1/backoffice/agency-enrollments')
@UseGuards(StaffSessionGuard)
export class BackofficeAgencyController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(OTP_PEPPER) private readonly otpPepper: Uint8Array | null,
    @Inject(PII_KEYS) private readonly piiKeys: PiiKeys | null,
  ) {}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'private, no-store')
  public async issue(@CurrentStaff() staff: AdminPrincipal, @Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const value = whitelistedBody(body, ['phone', 'documentType', 'cityId']);
    if (typeof value['phone'] !== 'string') throw new BusinessError('REQUEST_INVALID', 'phone invalide');
    const phone = normalizePhone(value['phone']);
    const documentType = oneOf(value['documentType'], DOCUMENTS);
    const cityId = oneOf(value['cityId'], CITIES);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    assertAuthorized(staff, 'ENROLL_CUSTOMER_AT_AGENCY', { cityId });
    const pepper = this.otpPepper;
    const piiKeys = this.piiKeys;
    if (pepper === null || piiKeys === null) throw new BusinessError('SMS_UNCONFIGURED', 'Inscription non configurée');
    const protectedPhone = await protectPhone(phone, piiKeys);
    let code: string | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `bo-agency-enrollment:${staff.actorId}`, key, request: { phone: protectedPhone.key, documentType, cityId } },
      async (client) => {
        const issued = await issueAgencySignupCode(client, { phone: protectedPhone, pepper, staffId: staff.actorId, cityId, documentType });
        code = issued.code;
        await appendAuditEvent(client, {
          eventType: 'BACKOFFICE_ACTION',
          actorId: staff.actorId,
          action: 'AGENCY_ENROLLMENT_ISSUED',
          targetType: 'OTP_CHALLENGE',
          targetId: issued.challengeId,
          outcome: 'SUCCESS',
          refs: { challenge_id: issued.challengeId, city_id: cityId, document_type: documentType },
        });
        // Réponse conservée pour le rejeu : SANS le code.
        return { status: 201, body: { challengeId: issued.challengeId, expiresAt: issued.expiresAt } };
      },
    );
    const stored = result.body as { readonly challengeId: string; readonly expiresAt: string };
    // Rejeu : même challengeId, mais plus de code : il n'existe qu'en mémoire, à la première exécution
    // (sur un rejeu, la fonction ci-dessus ne s'exécute pas et `code` reste nul).
    return { challengeId: stored.challengeId, expiresAt: stored.expiresAt, code };
  }
}
