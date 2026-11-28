import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrôles statiques de production, en liste blanche (refus par défaut) :
 * - NF-COMP-001 : Android 8.0+ (minSdk 26, explicite) et iOS 15+ ;
 * - REG-DPD-003 : minimisation — aucune collecte de contacts, SMS, journaux
 *   d'appels ni de localisation continue ; la géolocalisation se limite à la
 *   boutique lors d'une remise (portail partenaire) ;
 * - NF-PORT-002 : aucune dépendance à un fournisseur cloud dans le code
 *   métier ; seuls les adaptateurs isolés y touchent.
 */
const ROOT = resolve(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

function files(directory: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, directory))) {
    if (['node_modules', '.next', 'build', '.dart_tool', 'dist', 'Pods'].includes(entry) || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(join(ROOT, path)).isDirectory()) found.push(...files(path, pattern));
    else if (pattern.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

describe('NF-COMP-001 — versions minimales des systèmes mobiles', () => {
  it('Android : minSdk 26 (Android 8.0) fixé explicitement, pas la valeur par défaut de Flutter', () => {
    const gradle = read('apps/mobile/android/app/build.gradle.kts');
    expect(gradle).toMatch(/^\s*minSdk = 26\s*$/m);
    expect(gradle).not.toMatch(/minSdk = flutter\.minSdkVersion/);
  });

  it('iOS : cible de déploiement 15.0 dans toutes les configurations', () => {
    const targets = [...read('apps/mobile/ios/Runner.xcodeproj/project.pbxproj').matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(targets)).toEqual(new Set(['15.0']));
  });
});

describe('REG-DPD-003 — minimisation des données collectées par les applications', () => {
  it('Android : la seule permission est INTERNET, dans tous les manifestes', () => {
    const manifests = files('apps/mobile/android', /^AndroidManifest\.xml$/);
    expect(manifests.length).toBeGreaterThanOrEqual(1);
    for (const manifest of manifests) {
      const permissions = [...read(manifest).matchAll(/uses-permission[^>]*android:name="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(permissions), manifest).toEqual(new Set(['android.permission.INTERNET']));
    }
  });

  it('iOS : aucune demande d’accès (contacts, localisation, photos, micro, caméra…) dans Info.plist', () => {
    expect(read('apps/mobile/ios/Runner/Info.plist')).not.toMatch(/<key>NS[A-Za-z]*UsageDescription<\/key>/);
  });

  it('Flutter : dépendances en liste blanche (aucune extension d’accès aux contacts, SMS, appels ou localisation)', () => {
    const pubspec = read('apps/mobile/pubspec.yaml');
    const block = /^dependencies:\n((?:[ ]{2}.*\n)+)/m.exec(pubspec)?.[1] ?? '';
    const names = [...block.matchAll(/^ {2}([a-z_][a-z0-9_]*):/gm)].map((match) => match[1]);
    expect(names.sort()).toEqual(['cupertino_icons', 'flutter', 'http']);
  });

  it('web : géolocalisation seulement au comptoir de remise du portail partenaire ; aucun accès aux contacts', () => {
    const sources = ['apps/web-client/src', 'apps/back-office/src', 'apps/partner-portal/src', 'apps/mobile/lib'].flatMap((directory) => files(directory, /\.(ts|tsx|dart)$/));
    const geolocation = sources.filter((path) => /navigator\.geolocation|Geolocator|geolocator/.test(read(path))).map((path) => relative(ROOT, join(ROOT, path)));
    // Seul le port du comptoir de remise (portail partenaire) lit la position, une fois par remise.
    expect(geolocation).toEqual(['apps/partner-portal/src/lib/ports.ts']);
    const counter = read('apps/partner-portal/src/lib/ports.ts');
    expect(counter.match(/navigator\.geolocation\.\w+/g)).toEqual(['navigator.geolocation.getCurrentPosition']);
    // Jamais de suivi continu de la position (REG-DPD-003).
    expect(sources.filter((path) => /watchPosition|getPositionStream|startLocationUpdates/.test(read(path)))).toEqual([]);
    expect(sources.filter((path) => /navigator\.contacts|ContactsManager|flutter_contacts|telephony|call_log/.test(read(path)))).toEqual([]);
  });
});

describe('NF-PORT-002 — aucun fournisseur cloud dans le code métier', () => {
  it('le SDK AWS n’est importé que par l’adaptateur KMS ; Twilio n’est joint que par son adaptateur', () => {
    const api = files('apps/api/src', /\.ts$/);
    expect(api.filter((path) => /['"]@aws-sdk\//.test(read(path)))).toEqual(['apps/api/src/crypto/aws-kms.ts']);
    expect(api.filter((path) => /api\.twilio\.com/.test(read(path)))).toEqual(['apps/api/src/modules/identity/twilio-sms.ts']);
    expect(api.filter((path) => /neon\.tech|amazonaws\.com|\.azure\.|googleapis\.com/.test(read(path)))).toEqual([]);
  });

  it('dépendances de l’API : un seul paquet de fournisseur cloud, celui de l’adaptateur KMS', () => {
    const dependencies = Object.keys((JSON.parse(read('apps/api/package.json')) as { dependencies: Record<string, string> }).dependencies);
    expect(dependencies.filter((name) => /^@aws-sdk\/|^@google-cloud\/|^@azure\/|^firebase|^twilio$|^@neondatabase\//.test(name))).toEqual(['@aws-sdk/client-kms']);
  });
});
