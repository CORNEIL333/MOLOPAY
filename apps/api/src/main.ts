import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createDatabase, databaseConfigFromEnv } from './http/database';
import { allowedOriginsFromEnv } from './http/origin.guard';
import { pinPepperFromEnv } from './modules/identity/pin.store';

export async function bootstrap(): Promise<void> {
  const database = createDatabase(databaseConfigFromEnv(process.env));
  const app = await NestFactory.create(
    AppModule.register({
      database,
      allowedOrigins: allowedOriginsFromEnv(process.env),
      // Fermé par défaut : sans PIN_PEPPER, aucune action sous PIN n'est possible.
      pinPepper: process.env['PIN_PEPPER'] === undefined ? null : pinPepperFromEnv(process.env),
    }),
  );
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3000);
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
