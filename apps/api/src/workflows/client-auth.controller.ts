import { createHash } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { BusinessError } from '@achat/contracts';
import { PG_POOL, withTransaction, type Database } from '../http/database';
import type { HttpRequest } from '../http/express-types';
import { assertIdempotencyKey, runIdempotent } from '../http/idempotency';
import { CURRENT_TERMS_VERSION } from '../modules/agreements/goal.api';
import {
  completeSignup,
  devicePublicKeyPem,
  issueDeviceLoginChallenge,
  issueSignupOtp,
  openDeviceSession,
  tryVerifyOtp,
  verifyDeviceLogin,
} from '../modules/identity/client-auth.store';
import { issuedSessionCookies } from '../modules/identity/client-cookies';
import { assertStrongPin, normalizePhone, type IssuedSession } from '../modules/identity/domain';
import { OTP_PEPPER, otpSmsText, SMS_SENDER, type SmsSender } from '../modules/identity/sms.port';
import { PIN_PEPPER } from './goal-signing.controller';

type CookieResponse = { setHeader(name: string, value: readonly string[]): void };

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(message: string): never {
  throw new BusinessError('REQUEST_INVALID', message);
}

/** Corps en liste blanche : exactement ces champs, tous textuels. */
function fields<K extends string>(body: unknown, keys: readonly K[]): Record<K, string> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) invalid('Corps de requête invalide');
  const record = body as Record<string, unknown>;
  const present = Object.keys(record).sort();
  if (present.length !== keys.length || present.join() !== [...keys].sort().join()) invalid('Corps de requête invalide');
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || value.length > 4096) invalid(`${key} invalide`);
    out[key] = value;
  }
  return out;
}

function uuid(value: string, name: string): string {
  if (!UUID_V7.test(value)) invalid(`${name} invalide`);
  return value;
}

function hashOf(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * C2 / SEC-AUTH-001, F-ACC-001/002/004, D71 : inscription du client par OTP
 * (SMS) et connexion par appareil enregistré + PIN. Fermé par défaut : sans
 * prestataire SMS ni poivre OTP, l'inscription répond 503 ; sans poivre PIN,
 * l'inscription et la connexion répondent 503. Les cookies de session ne sont
 * émis qu'à la première exécution d'une requête (jamais sur une réponse
 * rejouée). Aucun PIN, code OTP ou signature n'entre dans l'empreinte
 * d'idempotence en clair.
 */
@Controller('v1/auth')
export class ClientAuthController {
  public constructor(
    @Inject(PG_POOL) private readonly database: Database,
    @Inject(SMS_SENDER) private readonly sms: SmsSender | null,
    @Inject(OTP_PEPPER) private readonly otpPepper: Uint8Array | null,
    @Inject(PIN_PEPPER) private readonly pinPepper: Uint8Array | null,
  ) {}

  /** F-ACC-001 : code d'inscription envoyé par SMS ; réponse identique que le numéro soit inscrit ou non. */
  @Post('otp-challenges')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async otp(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const value = fields(body, ['phone', 'purpose']);
    if (value.purpose !== 'SIGNUP') invalid('purpose : SIGNUP seulement');
    const phone = normalizePhone(value.phone);
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const sms = this.sms;
    const pepper = this.otpPepper;
    if (sms === null || pepper === null) {
      throw new BusinessError('SMS_UNCONFIGURED', 'Envoi de SMS non configuré');
    }
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `otp-signup:${phone}`, key, request: { phone, purpose: 'SIGNUP' } }, async (client) => {
      const issued = await issueSignupOtp(client, { phone, pepper });
      try {
        // Envoi avant validation : un échec annule le défi (aucun code valable sans SMS reçu).
        await sms.send({ phone: issued.phone, text: otpSmsText(issued.code) });
      } catch {
        throw new BusinessError('SMS_DELIVERY_FAILED', 'Le SMS n’a pas pu être envoyé');
      }
      return { status: 201, body: { challengeId: issued.challengeId, expiresAt: issued.expiresAt } };
    });
    return result.body;
  }

  /** F-ACC-001/002/004 : compte, appareil, PIN, conditions et première session sur le code reçu. */
  @Post('signups')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async signup(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    const value = fields(body, ['challengeId', 'code', 'pin', 'devicePublicKey', 'deviceName', 'acceptTermsVersion']);
    const challengeId = uuid(value.challengeId, 'challengeId');
    if (!/^[0-9]{6}$/.test(value.code)) invalid('code : six chiffres');
    assertStrongPin(value.pin);
    const publicKeyPem = devicePublicKeyPem(value.devicePublicKey);
    const deviceName = value.deviceName.trim();
    if (deviceName.length < 1 || deviceName.length > 100 || /\p{Cc}/u.test(deviceName)) invalid('deviceName : 1 à 100 caractères');
    if (value.acceptTermsVersion !== CURRENT_TERMS_VERSION) invalid('version des conditions non courante');
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const otpPepper = this.otpPepper;
    const pinPepper = this.pinPepper;
    if (otpPepper === null) throw new BusinessError('SMS_UNCONFIGURED', 'Inscription non configurée');
    if (pinPepper === null) throw new BusinessError('PIN_UNCONFIGURED', 'Vérification du PIN non configurée');
    // Étape 1, validée seule : l'essai de code reste décompté même en cas de refus.
    const verified = await withTransaction({ ...this.database, role: 'app_rw' }, (client) => tryVerifyOtp(client, { challengeId, code: value.code, pepper: otpPepper }));
    if (!verified.ok && verified.error.code !== 'IDENTITY_OTP_REPLAYED') {
      throw verified.error;
    }
    let issued: IssuedSession | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `signup:${challengeId}`, key, request: { challengeId, device: hashOf(publicKeyPem), deviceName, terms: value.acceptTermsVersion } },
      async (client) => {
        if (!verified.ok) throw verified.error;
        const signup = await completeSignup(client, {
          proof: verified.proof, otpPepper, pinPepper, devicePublicKeyPem: publicKeyPem, deviceName, pin: value.pin, termsVersion: value.acceptTermsVersion,
        });
        issued = signup.issued;
        return { status: 201, body: { accountId: signup.accountId, deviceId: signup.issued.session.deviceId, accessExpiresAt: signup.issued.session.accessExpiresAt } };
      },
    );
    if (!result.replayed && issued !== null) {
      response.setHeader('Set-Cookie', issuedSessionCookies(issued));
    }
    return result.body;
  }

  /** D71 : défi de connexion d'un appareil enregistré (indiscernable pour un appareil inconnu). */
  @Post('device-challenges')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async challenge(@Req() request: HttpRequest, @Body() body: unknown): Promise<unknown> {
    const deviceId = uuid(fields(body, ['deviceId']).deviceId, 'deviceId');
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const result = await runIdempotent({ ...this.database, role: 'app_rw' }, { scope: `device-challenge:${deviceId}`, key, request: { deviceId } }, async (client) => ({
      status: 201,
      body: { ...(await issueDeviceLoginChallenge(client, deviceId)) },
    }));
    return result.body;
  }

  /** D71 / SEC-AUTH-001 : connexion par signature du défi par l'appareil, puis PIN. */
  @Post('sessions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  public async login(@Req() request: HttpRequest, @Body() body: unknown, @Res({ passthrough: true }) response: CookieResponse): Promise<unknown> {
    const value = fields(body, ['challengeId', 'deviceId', 'signature', 'pin']);
    const challengeId = uuid(value.challengeId, 'challengeId');
    const deviceId = uuid(value.deviceId, 'deviceId');
    if (!/^[A-Za-z0-9+/_-]{80,90}={0,2}$/.test(value.signature)) invalid('signature : 64 octets en base64');
    const signature = Buffer.from(value.signature, 'base64');
    if (!/^[0-9]{6}$/.test(value.pin)) invalid('pin : six chiffres');
    const key = assertIdempotencyKey(request.headers['idempotency-key']);
    const pinPepper = this.pinPepper;
    if (pinPepper === null) throw new BusinessError('PIN_UNCONFIGURED', 'Vérification du PIN non configurée');
    // Étape 1, validée seule : défi consommé et essai de PIN décompté même en cas de refus.
    const verified = await withTransaction({ ...this.database, role: 'app_rw' }, (client) =>
      verifyDeviceLogin(client, { challengeId, deviceId, signature, pin: value.pin, pinPepper }),
    );
    if (!verified.ok && verified.error.code !== 'IDENTITY_SESSION_INVALID') {
      throw verified.error;
    }
    let issued: IssuedSession | null = null;
    const result = await runIdempotent(
      { ...this.database, role: 'app_rw' },
      { scope: `client-login:${challengeId}`, key, request: { challengeId, deviceId, signature: hashOf(signature) } },
      async (client) => {
        if (!verified.ok) throw verified.error;
        issued = await openDeviceSession(client, { accountId: verified.accountId, deviceId });
        return { status: 201, body: { accountId: verified.accountId, accessExpiresAt: issued.session.accessExpiresAt } };
      },
    );
    if (!result.replayed && issued !== null) {
      response.setHeader('Set-Cookie', issuedSessionCookies(issued));
    }
    return result.body;
  }
}
