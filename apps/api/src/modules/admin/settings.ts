import { canonicalize, type JsonValue } from '@achat/chain';
import { BusinessError } from '@achat/contracts';
import { type ApprovalRequest } from './domain';

export type SettingVersion = {
  readonly key: string;
  readonly version: number;
  readonly value: JsonValue;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly requestId: string;
};

export type CreateSettingVersionInput = {
  readonly key: string;
  readonly value: JsonValue;
  readonly createdAt: string;
  readonly request: ApprovalRequest;
};

const KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const ISO_UTC_MS_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail(message: string): never {
  throw new BusinessError('ADMIN_INVALID_REQUEST', message);
}

/**
 * Une version n'existe qu'après approbation maker-checker d'une demande de
 * type FINANCIAL_SETTING. L'historique est immuable : une nouvelle valeur
 * crée toujours la version suivante.
 */
export function createSettingVersion(
  input: CreateSettingVersionInput,
  existing: readonly SettingVersion[],
): SettingVersion {
  if (!KEY_PATTERN.test(input.key)) {
    fail('Clé de paramètre invalide');
  }
  if (
    !ISO_UTC_MS_PATTERN.test(input.createdAt) ||
    Number.isNaN(new Date(input.createdAt).getTime()) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  ) {
    fail('createdAt doit être ISO 8601 UTC avec millisecondes');
  }
  if (input.request.kind !== 'FINANCIAL_SETTING') {
    fail('La demande ne porte pas sur un paramètre financier');
  }
  if (input.request.status !== 'APPROVED') {
    fail('Le paramètre doit être approuvé avant publication');
  }
  if (existing.some((entry) => entry.requestId === input.request.id)) {
    fail('Demande déjà publiée dans une version de paramètre');
  }
  try {
    canonicalize(input.value);
  } catch (error: unknown) {
    fail(
      `Valeur non canonisable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const versions = existing
    .filter((entry) => entry.key === input.key)
    .map((entry) => entry.version);
  const nextVersion =
    versions.length === 0 ? 1 : Math.max(...versions) + 1;
  return {
    key: input.key,
    version: nextVersion,
    value: input.value,
    createdBy: input.request.makerId,
    createdAt: input.createdAt,
    requestId: input.request.id,
  };
}

export function currentSetting(
  versions: readonly SettingVersion[],
  key: string,
): SettingVersion | null {
  let current: SettingVersion | null = null;
  for (const entry of versions) {
    if (entry.key !== key) {
      continue;
    }
    if (current === null || entry.version > current.version) {
      current = entry;
    }
  }
  return current;
}
