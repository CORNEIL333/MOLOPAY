import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SEC-CRY-006 : l'inventaire cryptographique (algorithmes, longueurs,
 * emplacements) est tenu à jour pour préparer la migration post-quantique.
 * « À jour » est vérifié ici dans les deux sens : tout emplacement du code de
 * production où un algorithme est employé figure dans l'inventaire, et
 * l'inventaire ne cite aucun emplacement qui ne l'emploie plus. Ajouter un
 * algorithme inconnu des détecteurs fait aussi échouer le contrôle.
 */
const ROOT = resolve(__dirname, '..');
const INVENTORY = resolve(ROOT, 'docs/04_annexes/INVENTAIRE_CRYPTOGRAPHIQUE.md');
const SCANNED = ['apps', 'packages', 'tools', 'db'];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'target', 'coverage', 'fixtures', 'test', 'build', '.dart_tool']);

/** Détecteurs : identifiant de ligne de l'inventaire → motif dans le code. */
export const DETECTORS: Readonly<Record<string, RegExp>> = {
  'SHA-256': /createHash\('sha256'\)|digest\('SHA-256'|\bsha256\(/,
  'HMAC-SHA-256': /createHmac\('sha256'/,
  'AES-256-GCM': /aes-256-gcm/,
  Ed25519: /ed25519|Ed25519/,
  'WEBAUTHN-ES256-EDDSA': /\bES256\b|\bEdDSA\b/,
  Argon2id: /argon2id/,
  'AWS-KMS': /@aws-sdk\/client-kms/,
};

/** Motifs d'algorithmes faibles ou non inventoriés : leur apparition doit être une décision explicite. */
const UNLISTED = /createHash\('(?:md5|sha1|sha224|sha384|sha512)'\)|createCipheriv\('(?!aes-256-gcm')|\b(?:pbkdf2|scrypt)(?:Sync)?\(|createSign\('RSA|'rsa'|\bdes-ede3?\b/i;

// Chemins de l'inventaire en séparateur POSIX, quel que soit le système.
const toPosix = (path: string): string => path.split(sep).join('/');

function sources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (/\.(ts|tsx|sql|dart|rs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !/_test\.dart$/.test(entry) && !entry.endsWith('.d.ts')) {
      found.push(path);
    }
  }
  return found;
}

function scan(): { readonly files: string[]; readonly usages: Map<string, Set<string>> } {
  const files = SCANNED.flatMap((top) => sources(resolve(ROOT, top)));
  const usages = new Map<string, Set<string>>(Object.keys(DETECTORS).map((id) => [id, new Set<string>()]));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [id, pattern] of Object.entries(DETECTORS)) {
      if (pattern.test(text)) usages.get(id)?.add(toPosix(relative(ROOT, file)));
    }
  }
  return { files, usages };
}

/** Lignes du tableau : `| ID | … | Post-quantique | `emplacement`, … |`. */
export function parseInventory(markdown: string): Map<string, { readonly postQuantum: string; readonly locations: Set<string> }> {
  const rows = new Map<string, { postQuantum: string; locations: Set<string> }>();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 8) continue;
    const id = /^`([A-Za-z0-9-]+)`$/.exec(cells[1] ?? '')?.[1];
    if (id === undefined) continue;
    if (rows.has(id)) throw new Error(`ligne en double : ${id}`);
    const locations = new Set([...(cells[6] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''));
    rows.set(id, { postQuantum: cells[5] ?? '', locations });
  }
  return rows;
}

describe('SEC-CRY-006 inventaire cryptographique à jour', () => {
  const { files, usages } = scan();
  const inventory = parseInventory(readFileSync(INVENTORY, 'utf8'));

  it('le contrôle porte sur tout le code de production, toutes piles (TypeScript, SQL, Dart, Rust)', () => {
    expect(files.length).toBeGreaterThan(300);
    for (const extension of ['.ts', '.sql', '.dart', '.rs']) {
      expect(files.some((file) => file.endsWith(extension)), extension).toBe(true);
    }
  });

  it('chaque algorithme détecté a sa ligne, et l’inventaire n’a pas de ligne inconnue des détecteurs', () => {
    expect([...inventory.keys()].sort()).toEqual(Object.keys(DETECTORS).sort());
  });

  it('les emplacements de l’inventaire sont exactement ceux du code (dans les deux sens)', () => {
    for (const [id, found] of usages) {
      const listed = inventory.get(id)?.locations ?? new Set<string>();
      expect({ id, missing: [...found].filter((file) => !listed.has(file)).sort(), stale: [...listed].filter((file) => !found.has(file)).sort() }).toEqual({ id, missing: [], stale: [] });
      expect(found.size, id).toBeGreaterThan(0);
    }
  });

  it('chaque ligne indique sa position post-quantique (à conserver ou à migrer, et vers quoi)', () => {
    for (const [id, row] of inventory) {
      expect(row.postQuantum, id).toMatch(/^(Conservé|À migrer) : .{10,}/);
    }
  });

  it('aucun algorithme faible ou non inventorié dans le code de production', () => {
    const offenders = files.filter((file) => UNLISTED.test(readFileSync(file, 'utf8'))).map((file) => toPosix(relative(ROOT, file)));
    expect(offenders).toEqual([]);
  });

  it('refuse : un inventaire périmé ou incomplet est détecté (contrôle du contrôle)', () => {
    const sample = [...(usages.get('AES-256-GCM') ?? [])][0] ?? '';
    expect(existsSync(resolve(ROOT, sample))).toBe(true);
    const rows = parseInventory('| `AES-256-GCM` | u | a | b | Conservé : symétrique, 256 bits | `ancien/fichier.ts` |');
    expect(rows.get('AES-256-GCM')?.locations.has(sample)).toBe(false);
    expect(() => parseInventory('| `X` | u | a | b | Conservé : xxxxxxxxxxxx | `a` |\n| `X` | u | a | b | Conservé : xxxxxxxxxxxx | `a` |')).toThrow(/double/);
  });
});
