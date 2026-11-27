import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { distinctPeppers, handoverPepperFromEnv, relyingPartyFromEnv } from './config/production-config';
import { createDatabase, databaseConfigFromEnv } from './http/database';
import { verifySchemaAtStartup } from './http/migration-manifest';
import { allowedOriginsFromEnv } from './http/origin.guard';
import { piiKeysFromEnv } from './modules/identity/phone-key';
import { pinPepperFromEnv } from './modules/identity/pin.store';
import { twilioConfigFromEnv, twilioSmsSender } from './modules/identity/twilio-sms';

function smsSenderFromEnv(env: NodeJS.ProcessEnv): ReturnType<typeof twilioSmsSender> | null {
  const config = twilioConfigFromEnv(env);
  return config === null ? null : twilioSmsSender(config);
}

export async function bootstrap(): Promise<void> {
  const database = createDatabase(databaseConfigFromEnv(process.env));
  // N6 : en production, refus de démarrer sur une base dont le schéma n'est pas exactement celui de ce code.
  await verifySchemaAtStartup(database, process.env);
  const pinPepper = process.env['PIN_PEPPER'] === undefined ? null : pinPepperFromEnv(process.env);
  const otpPepper = process.env['OTP_PEPPER'] === undefined ? null : pinPepperFromEnv(process.env, 'OTP_PEPPER');
  const handoverPepper = handoverPepperFromEnv(process.env);
  distinctPeppers({ PIN_PEPPER: pinPepper, OTP_PEPPER: otpPepper, HANDOVER_PEPPER: handoverPepper });
  const app = await NestFactory.create(
    AppModule.register({
      database,
      // Connexions par clé d'accès (WebAuthn) du personnel et des partenaires ; absentes : fermées (503).
      staffRp: relyingPartyFromEnv(process.env, 'STAFF'),
      partnerRp: relyingPartyFromEnv(process.env, 'PARTNER'),
      // Code de remise à usage unique ; sans poivre : remise fermée.
      handoverPepper,
      // D5 : instructions signées seulement par une clé en HSM (signataire KMS à venir) ; pas de versement au lancement.
      platformSigningKey: null,
      allowedOrigins: allowedOriginsFromEnv(process.env),
      // Fermé par défaut : sans PIN_PEPPER, aucune action sous PIN n'est possible.
      pinPepper,
      // C2 : poivre OTP. SMS par Twilio (D1, 24 novembre) seulement si sa configuration est complète
      // et valide ; sinon envoi fermé (503 SMS_UNCONFIGURED).
      otpPepper,
      smsSender: smsSenderFromEnv(process.env),
      // C14 : clés de protection du numéro (AWS KMS) ; absentes : inscription fermée.
      piiKeys: await piiKeysFromEnv(process.env),
    }),
  );
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
