import { ChainError } from './errors';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const MAX_DEPTH = 32;

/**
 * Sérialisation canonique RFC 8785 (JCS) restreinte au sous-ensemble du
 * grand livre : chaînes, booléens, null, tableaux, objets et entiers sûrs.
 * Les flottants sont refusés : aucun montant ne doit passer par un nombre
 * flottant (I-12). Les clés sont triées par unités de code UTF-16.
 */
export function canonicalize(value: JsonValue): string {
  return serialize(value, 0, new WeakSet<object>());
}

function serialize(
  value: JsonValue,
  depth: number,
  seen: WeakSet<object>,
): string {
  if (depth > MAX_DEPTH) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Profondeur JSON excessive',
    );
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return encodeString(value);
  }
  if (typeof value === 'number') {
    return encodeNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'Référence circulaire dans le contenu canonique',
      );
    }
    seen.add(value);
    const items = value as readonly JsonValue[];
    const parts = items.map((item) => serialize(item, depth + 1, seen));
    seen.delete(value);
    return `[${parts.join(',')}]`;
  }
  if (typeof value !== 'object') {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Type JSON non supporté dans le contenu canonique',
    );
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Seuls les objets JSON simples sont acceptés',
    );
  }
  if (seen.has(value)) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Référence circulaire dans le contenu canonique',
    );
  }
  seen.add(value);
  const record = value as Readonly<Record<string, JsonValue>>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = record[key];
    if (item === undefined) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'Valeur undefined interdite dans le contenu canonique',
      );
    }
    parts.push(`${encodeString(key)}:${serialize(item, depth + 1, seen)}`);
  }
  seen.delete(value);
  return `{${parts.join(',')}}`;
}

function encodeNumber(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new ChainError(
      'CHAIN_INVALID_CONTENT',
      'Seuls les entiers sûrs sont autorisés dans le contenu canonique',
    );
  }
  return Object.is(value, -0) ? '0' : String(value);
}

function encodeString(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ChainError(
          'CHAIN_INVALID_CONTENT',
          'Chaîne UTF-16 mal formée (demi-paire isolée)',
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ChainError(
        'CHAIN_INVALID_CONTENT',
        'Chaîne UTF-16 mal formée (demi-paire isolée)',
      );
    }
  }

  let result = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    switch (code) {
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += '\\\\';
        break;
      case 0x08:
        result += '\\b';
        break;
      case 0x09:
        result += '\\t';
        break;
      case 0x0a:
        result += '\\n';
        break;
      case 0x0c:
        result += '\\f';
        break;
      case 0x0d:
        result += '\\r';
        break;
      default:
        if (code < 0x20) {
          result += `\\u${code.toString(16).padStart(4, '0')}`;
        } else if (code >= 0xd800 && code <= 0xdbff) {
          result += value.slice(index, index + 2);
          index += 1;
        } else {
          result += value.charAt(index);
        }
    }
  }
  return `${result}"`;
}
