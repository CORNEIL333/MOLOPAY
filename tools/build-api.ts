import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * P2 : artefact de production de l'API. Un seul fichier JavaScript
 * (`apps/api/dist/main.cjs`, à côté de `apps/api/node_modules`) : le code de l'API et des paquets de l'espace de
 * travail (`@achat/*`, écrits en TypeScript) est regroupé ; les dépendances
 * publiées restent externes et sont installées, épinglées, par
 * `pnpm install --prod --frozen-lockfile` sur le serveur (modules natifs
 * compris, comme Argon2). Pas de carte des sources (aucun code source livré).
 * L'image doit aussi contenir `db/migrations` (contrôle de démarrage N6).
 */
const ROOT = resolve(__dirname, '..');

export async function buildApi(input: { readonly outDir?: string } = {}): Promise<{ readonly file: string }> {
  const outDir = input.outDir ?? join(ROOT, 'apps', 'api', 'dist');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'main.cjs');
  await build({
    entryPoints: [join(ROOT, 'apps/api/src/main.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [
      {
        name: 'dependances-publiees-externes',
        setup(builder) {
          // Toute importation nue est externe, sauf les paquets de l'espace de travail (regroupés).
          builder.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@achat/') ? undefined : { path: args.path, external: true }));
        },
      },
    ],
  });
  return { file };
}

if (require.main === module) {
  buildApi().then(
    (result) => { process.stdout.write(`${JSON.stringify({ status: 'DONE', file: result.file.replace(`${ROOT}/`, '') })}\n`); },
    () => { process.stdout.write('{"status":"ERROR","code":"BUILD_FAILED"}\n'); process.exitCode = 1; },
  );
}
