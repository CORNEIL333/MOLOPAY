import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeEntryHash,
  type EntryContent,
  type JsonValue,
} from '../packages/chain/src/index';

type FixturePosting = {
  account_id: string;
  amount_xaf: string;
  direction: 'D' | 'C';
  ordinal: number;
};

type FixtureEntry = {
  seq: number;
  id: string;
  ts: string;
  type: string;
  refs: Record<string, JsonValue>;
  postings: FixturePosting[];
  actor: string;
  approvers: string[];
  idem_scope: string;
  idem_key: string;
  reverses_entry_id: string | null;
  prev_hash: string;
  entry_hash: string;
};

type FixtureTreeHead = {
  tree_size: number;
  root_hash: string;
  timestamp: string;
  log_id: string;
  signature: string;
};

type FixtureWitnessHead = {
  tree_size: number;
  root_hash: string;
};

type FixtureExport = {
  version: number;
  log_id: string;
  generated_at: string;
  entries: FixtureEntry[];
  tree_heads: FixtureTreeHead[];
  witness_heads: FixtureWitnessHead[];
};

const ROOT = process.cwd();
const BINARY_NAME = process.platform === 'win32' ? 'verifier.exe' : 'verifier';
const BINARY = path.join(
  ROOT,
  'tools',
  'verifier',
  'target',
  'release',
  BINARY_NAME,
);
const MANIFEST = path.join(ROOT, 'tools', 'verifier', 'Cargo.toml');
const FIXTURE_PATH = path.join(ROOT, 'tests', 'fixtures', 'ledger-export.json');
const PUBLIC_KEY_PATH = path.join(
  ROOT,
  'tests',
  'fixtures',
  'ledger-public-key.txt',
);
const TMP_DIR = path.join(ROOT, 'tests', `.tmp-verifier-${process.pid.toString()}`);

let baseExport: FixtureExport;
let fileCounter = 0;

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Élément absent: ${label}`);
  }
  return value;
}

function entryAt(draft: FixtureExport, index: number): FixtureEntry {
  return must(draft.entries[index], `entry[${index.toString()}]`);
}

function headAt(draft: FixtureExport, index: number): FixtureTreeHead {
  return must(draft.tree_heads[index], `tree_heads[${index.toString()}]`);
}

function witnessAt(draft: FixtureExport, index: number): FixtureWitnessHead {
  return must(draft.witness_heads[index], `witness_heads[${index.toString()}]`);
}

function flipHex(value: string): string {
  const first = value[0] ?? '0';
  return (first === '0' ? '1' : '0') + value.slice(1);
}

function toContent(entry: FixtureEntry): EntryContent {
  return {
    seq: entry.seq,
    id: entry.id,
    ts: entry.ts,
    type: entry.type,
    refs: entry.refs,
    postings: entry.postings.map((posting) => ({
      accountId: posting.account_id,
      direction: posting.direction,
      amountXaf: BigInt(posting.amount_xaf),
      ordinal: posting.ordinal,
    })),
    actor: entry.actor,
    approvers: entry.approvers,
    idemScope: entry.idem_scope,
    idemKey: entry.idem_key,
    reversesEntryId: entry.reverses_entry_id,
  };
}

function recomputeFrom(draft: FixtureExport, startIndex: number): void {
  for (let index = startIndex; index < draft.entries.length; index += 1) {
    const entry = entryAt(draft, index);
    const prevHex =
      index === 0 ? '00'.repeat(32) : entryAt(draft, index - 1).entry_hash;
    entry.prev_hash = prevHex;
    entry.entry_hash = computeEntryHash(
      Buffer.from(prevHex, 'hex'),
      toContent(entry),
    ).toString('hex');
  }
}

function appendComputedEntry(
  draft: FixtureExport,
  options: { readonly id: string; readonly idemKey: string },
): void {
  const last = entryAt(draft, draft.entries.length - 1);
  const appended: FixtureEntry = {
    ...structuredClone(last),
    seq: last.seq + 1,
    id: options.id,
    ts: '2026-10-26T09:00:00.000Z',
    idem_key: options.idemKey,
    prev_hash: last.entry_hash,
    entry_hash: '',
  };
  appended.entry_hash = computeEntryHash(
    Buffer.from(last.entry_hash, 'hex'),
    toContent(appended),
  ).toString('hex');
  draft.entries.push(appended);
}

function writeExport(
  payload: FixtureExport | string,
  publicKeyPath = PUBLIC_KEY_PATH,
): SpawnSyncReturns<string> {
  fileCounter += 1;
  const exportPath = path.join(
    TMP_DIR,
    `export-${fileCounter.toString()}.json`,
  );
  writeFileSync(
    exportPath,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    'utf8',
  );
  return spawnSync(
    BINARY,
    ['-export', exportPath, '-public-key', publicKeyPath],
    { encoding: 'utf8' },
  );
}

function mutate(
  alter: (draft: FixtureExport) => void,
): FixtureExport {
  const draft = structuredClone(baseExport);
  alter(draft);
  return draft;
}

beforeAll(() => {
  const build = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', MANIFEST],
    { stdio: 'inherit' },
  );
  if (build.error !== undefined || build.status !== 0) {
    throw new Error(
      `Compilation du vérificateur impossible: ${build.error?.message ?? String(build.status)}`,
    );
  }
  if (!existsSync(BINARY)) {
    throw new Error(`Binaire release introuvable: ${BINARY}`);
  }
  mkdirSync(TMP_DIR, { recursive: true });
  baseExport = JSON.parse(
    readFileSync(FIXTURE_PATH, 'utf8'),
  ) as FixtureExport;
}, 300_000);

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('vérificateur indépendant · export de référence', () => {
  it('accepte l’export signé et couvert par un témoin', () => {
    const result = writeExport(baseExport);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'LEDGER VERIFIED entries=6 heads=3 witnesses=2',
    );
  });

  it('refuse un JSON malformé en entrée (code 2)', () => {
    const result = writeExport('{"version":1,');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('EXPORT_INVALID');
  });

  it('refuse un champ inconnu dans l’export (schéma strict)', () => {
    const draft = mutate((value) => {
      (value as FixtureExport & { rogue?: boolean }).rogue = true;
    });
    const result = writeExport(draft);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('EXPORT_INVALID');
  });

  it('refuse une clé publique étrangère au journal', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const raw = publicKey.export({ type: 'spki', format: 'der' });
    const otherKeyPath = path.join(TMP_DIR, 'other-public-key.txt');
    writeFileSync(otherKeyPath, raw.subarray(raw.length - 32).toString('hex'));
    const result = writeExport(baseExport, otherKeyPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SIGNATURE_INVALID');
  });
});

describe('vérificateur indépendant · altérations injectées', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly alter: (draft: FixtureExport) => void;
    readonly code: string;
  }> = [
    {
      name: 'montant',
      alter: (draft) => {
        entryAt(draft, 1).postings[0] = {
          ...must(entryAt(draft, 1).postings[0], 'posting 0'),
          amount_xaf: '15001',
        };
      },
      code: 'ENTRY_UNBALANCED',
    },
    {
      name: 'sens',
      alter: (draft) => {
        const posting = must(entryAt(draft, 1).postings[0], 'posting 0');
        posting.direction = posting.direction === 'D' ? 'C' : 'D';
      },
      code: 'ENTRY_UNBALANCED',
    },
    {
      name: 'séquence',
      alter: (draft) => {
        entryAt(draft, 2).seq = 4;
      },
      code: 'SEQUENCE_GAP',
    },
    {
      name: 'identifiant',
      alter: (draft) => {
        const entry = entryAt(draft, 5);
        entry.id = flipHex(entry.id);
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'prev_hash',
      alter: (draft) => {
        const entry = entryAt(draft, 2);
        entry.prev_hash = flipHex(entry.prev_hash);
      },
      code: 'PREV_HASH_MISMATCH',
    },
    {
      name: 'entry_hash',
      alter: (draft) => {
        const entry = entryAt(draft, 3);
        entry.entry_hash = flipHex(entry.entry_hash);
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'horodatage',
      alter: (draft) => {
        entryAt(draft, 1).ts = '2026-10-02T09:00:00.001Z';
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'type',
      alter: (draft) => {
        entryAt(draft, 1).type = 'PAYMENT_RETURNED';
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'approbateurs',
      alter: (draft) => {
        entryAt(draft, 1).approvers.push('intrus');
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'refs',
      alter: (draft) => {
        entryAt(draft, 1).refs = { payment_id: 'pay-001', plan_id: 'plan-002' };
      },
      code: 'ENTRY_HASH_MISMATCH',
    },
    {
      name: 'lien de contre-passation',
      alter: (draft) => {
        entryAt(draft, 4).reverses_entry_id = entryAt(draft, 2).id;
        recomputeFrom(draft, 4);
      },
      code: 'REVERSAL_INVALID',
    },
    {
      name: 'suppression d’écriture',
      alter: (draft) => {
        draft.entries.splice(2, 1);
      },
      code: 'SEQUENCE_GAP',
    },
    {
      name: 'ajout chaîné hors tête signée',
      alter: (draft) => {
        appendComputedEntry(draft, {
          id: '019a0000-0000-7000-8000-000000000007',
          idemKey: 'append-007',
        });
      },
      code: 'HEAD_COVERAGE_MISSING',
    },
    {
      name: 'rejeu de clé d’idempotence',
      alter: (draft) => {
        const last = entryAt(draft, draft.entries.length - 1);
        appendComputedEntry(draft, {
          id: '019a0000-0000-7000-8000-000000000008',
          idemKey: last.idem_key,
        });
      },
      code: 'IDEMPOTENCY_DUPLICATE',
    },
    {
      name: 'racine Merkle',
      alter: (draft) => {
        const head = headAt(draft, 1);
        head.root_hash = flipHex(head.root_hash);
      },
      code: 'MERKLE_ROOT_MISMATCH',
    },
    {
      name: 'signature',
      alter: (draft) => {
        headAt(draft, 0).signature = Buffer.alloc(64).toString('base64');
      },
      code: 'SIGNATURE_INVALID',
    },
    {
      name: 'taille de tête',
      alter: (draft) => {
        headAt(draft, 1).tree_size = 3;
      },
      code: 'MERKLE_ROOT_MISMATCH',
    },
    {
      name: 'témoin (racine)',
      alter: (draft) => {
        const witness = witnessAt(draft, 0);
        witness.root_hash = flipHex(witness.root_hash);
      },
      code: 'WITNESS_MISMATCH',
    },
    {
      name: 'témoin (taille)',
      alter: (draft) => {
        witnessAt(draft, 0).tree_size = 5;
      },
      code: 'WITNESS_MISMATCH',
    },
    {
      name: 'log_id',
      alter: (draft) => {
        draft.log_id = 'achat-ledger-other-v1';
      },
      code: 'TREE_HEAD_INVALID',
    },
    {
      name: 'absence de tête signée',
      alter: (draft) => {
        draft.tree_heads = [];
      },
      code: 'HEAD_COVERAGE_MISSING',
    },
    {
      name: 'absence de témoin',
      alter: (draft) => {
        draft.witness_heads = [];
      },
      code: 'WITNESS_MISSING',
    },
    {
      name: 'témoin ne couvrant pas tout l’export',
      alter: (draft) => {
        const head = headAt(draft, 0);
        draft.witness_heads = [
          { tree_size: head.tree_size, root_hash: head.root_hash },
        ];
      },
      code: 'WITNESS_COVERAGE_MISSING',
    },
  ];

  it.each(cases)('détecte l’altération: $name', ({ alter, code }) => {
    const result = writeExport(mutate(alter));
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`VERIFICATION_FAILED ${code}`);
  });
});
