import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  buildBatch,
  computeEntryHash,
  genesisPrevHash,
  merkleTreeHash,
  signTreeHead,
  type EntryContent,
  type EntryPosting,
  type TreeHead,
} from '../../packages/chain/src/index';

const OUT_DIR = path.join('tests', 'fixtures');
const EXPORT_PATH = path.join(OUT_DIR, 'ledger-export.json');
const PUBLIC_KEY_PATH = path.join(OUT_DIR, 'ledger-public-key.txt');

const ACCOUNT_TREASURY = '019a0000-0000-7000-8000-000000001100';
const ACCOUNT_TRANSIT = '019a0000-0000-7000-8000-000000001200';
const ACCOUNT_SUSPENSE = '019a0000-0000-7000-8000-000000002900';
const ACCOUNT_FEES = '019a0000-0000-7000-8000-000000006100';
const ACCOUNT_COMMISSION = '019a0000-0000-7000-8000-000000007100';

const LOG_ID = 'achat-ledger-fixture-v1';

type FixtureEntry = {
  readonly content: EntryContent;
  readonly prevHash: Buffer;
  readonly entryHash: Buffer;
};

function posting(
  accountId: string,
  direction: 'D' | 'C',
  amountXaf: bigint,
  ordinal: number,
): EntryPosting {
  return { accountId, direction, amountXaf, ordinal };
}

function entry(
  seq: number,
  id: string,
  ts: string,
  type: string,
  refs: Readonly<Record<string, string>>,
  postings: readonly EntryPosting[],
  actor: string,
  approvers: readonly string[],
  idemScope: string,
  idemKey: string,
  reversesEntryId: string | null = null,
): EntryContent {
  return {
    seq,
    id,
    ts,
    type,
    refs,
    postings,
    actor,
    approvers,
    idemScope,
    idemKey,
    reversesEntryId,
  };
}

const CONTENTS: readonly EntryContent[] = [
  entry(
    1,
    '019a0000-0000-7000-8000-000000000001',
    '2026-10-01T00:00:00.000Z',
    'GENESIS',
    { chart: 'v1', signing_key: 'fixture-only' },
    [],
    'system',
    ['founder'],
    'ledger',
    'genesis',
  ),
  entry(
    2,
    '019a0000-0000-7000-8000-000000000002',
    '2026-10-02T08:00:00.000Z',
    'PAYMENT_RECEIVED',
    { payment_id: 'pay-001', plan_id: 'plan-001' },
    [
      posting(ACCOUNT_TRANSIT, 'D', 15_000n, 1),
      posting(ACCOUNT_SUSPENSE, 'C', 15_000n, 2),
    ],
    'maker-1',
    ['checker-2', 'checker-1'],
    'payments',
    'pay-001:received',
  ),
  entry(
    3,
    '019a0000-0000-7000-8000-000000000003',
    '2026-10-03T08:00:00.000Z',
    'SETTLEMENT_SENT',
    { settlement_id: 'set-001' },
    [
      posting(ACCOUNT_SUSPENSE, 'D', 15_000n, 1),
      posting(ACCOUNT_TREASURY, 'C', 15_000n, 2),
    ],
    'system',
    ['treasury-1'],
    'settlements',
    'set-001',
  ),
  entry(
    4,
    '019a0000-0000-7000-8000-000000000004',
    '2026-10-04T08:00:00.000Z',
    'FEE_CHARGED',
    { fee_id: 'fee-001' },
    [
      posting(ACCOUNT_FEES, 'D', 500n, 1),
      posting(ACCOUNT_TRANSIT, 'C', 500n, 2),
    ],
    'system',
    ['finance-1'],
    'fees',
    'fee-001',
  ),
  entry(
    5,
    '019a0000-0000-7000-8000-000000000005',
    '2026-10-05T08:00:00.000Z',
    'PAYMENT_REVERSED',
    { payment_id: 'pay-001', reversal_id: 'rev-001' },
    [
      posting(ACCOUNT_SUSPENSE, 'D', 15_000n, 1),
      posting(ACCOUNT_TRANSIT, 'C', 15_000n, 2),
    ],
    'maker-2',
    ['checker-3'],
    'payments',
    'pay-001:reversed',
    '019a0000-0000-7000-8000-000000000002',
  ),
  entry(
    6,
    '019a0000-0000-7000-8000-000000000006',
    '2026-10-06T08:00:00.000Z',
    'ADJUSTMENT',
    { adjustment_id: 'adj-001' },
    [
      posting(ACCOUNT_TREASURY, 'D', 250n, 1),
      posting(ACCOUNT_COMMISSION, 'C', 250n, 2),
    ],
    'finance-2',
    ['controller-1'],
    'ledger',
    'adj-001',
  ),
];

function buildEntries(): FixtureEntry[] {
  const entries: FixtureEntry[] = [];
  let prevHash = genesisPrevHash();
  for (const content of CONTENTS) {
    const entryHash = computeEntryHash(prevHash, content);
    entries.push({ content, prevHash, entryHash });
    prevHash = entryHash;
  }
  return entries;
}

function head(treeSize: number, timestamp: string, hashes: readonly Buffer[]): TreeHead {
  return {
    treeSize,
    rootHash: merkleTreeHash(hashes.slice(0, treeSize)).toString('hex'),
    timestamp,
    logId: LOG_ID,
  };
}

function main(): void {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const entries = buildEntries();
  const hashes = entries.map((item) => item.entryHash);

  const heads = [
    head(2, '2026-10-02T09:00:00.000Z', hashes),
    head(4, '2026-10-04T09:00:00.000Z', hashes),
    head(6, '2026-10-06T09:00:00.000Z', hashes),
  ];
  const signed = heads.map((item) => signTreeHead(item, privateKey));
  const batch = buildBatch(
    entries.map((item) => ({
      seq: item.content.seq,
      entryHash: item.entryHash,
    })),
  );
  const lastHead = signed[signed.length - 1];
  const secondHead = signed[1];
  if (
    lastHead === undefined ||
    secondHead === undefined ||
    !batch.rootHash.equals(Buffer.from(lastHead.head.rootHash, 'hex'))
  ) {
    throw new Error('la dernière tête ne couvre pas tout le lot');
  }

  const jwk = publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string') {
    throw new Error('clé publique Ed25519 sans composante x');
  }
  const rawPublicKey = Buffer.from(jwk.x, 'base64url');
  if (rawPublicKey.length !== 32) {
    throw new Error('clé publique Ed25519 de taille invalide');
  }

  const payload = {
    version: 1,
    log_id: LOG_ID,
    generated_at: '2026-10-26T09:00:00.000Z',
    entries: entries.map((item) => ({
      seq: item.content.seq,
      id: item.content.id,
      ts: item.content.ts,
      type: item.content.type,
      refs: item.content.refs,
      postings: item.content.postings.map((line) => ({
        account_id: line.accountId,
        amount_xaf: line.amountXaf.toString(),
        direction: line.direction,
        ordinal: line.ordinal,
      })),
      actor: item.content.actor,
      approvers: item.content.approvers,
      idem_scope: item.content.idemScope,
      idem_key: item.content.idemKey,
      reverses_entry_id: item.content.reversesEntryId,
      prev_hash: item.prevHash.toString('hex'),
      entry_hash: item.entryHash.toString('hex'),
    })),
    tree_heads: signed.map((item) => ({
      tree_size: item.head.treeSize,
      root_hash: item.head.rootHash,
      timestamp: item.head.timestamp,
      log_id: item.head.logId,
      signature: item.signature,
    })),
    witness_heads: [
      {
        tree_size: lastHead.head.treeSize,
        root_hash: lastHead.head.rootHash,
      },
      {
        tree_size: secondHead.head.treeSize,
        root_hash: secondHead.head.rootHash,
      },
    ],
  };

  writeFileSync(EXPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  writeFileSync(PUBLIC_KEY_PATH, `${rawPublicKey.toString('hex')}\n`, 'utf8');
  process.stdout.write(
    `fixture écrite : ${EXPORT_PATH}, clé publique : ${PUBLIC_KEY_PATH}\n`,
  );
}

main();
