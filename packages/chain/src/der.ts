import { ChainError } from './errors';

export type DerNode = {
  readonly tag: number;
  readonly constructed: boolean;
  readonly raw: Buffer;
  readonly content: Buffer;
};

function fail(message: string): never {
  throw new ChainError('TIMESTAMP_INVALID', `DER: ${message}`);
}

export function readDer(
  buffer: Buffer,
  offset = 0,
  limit = buffer.length,
): DerNode {
  if (offset < 0 || limit > buffer.length || offset >= limit) {
    fail('élément absent ou bornes invalides');
  }
  const tag = buffer[offset];
  if (tag === undefined) {
    fail('élément tronqué');
  }
  if ((tag & 0x1f) === 0x1f) {
    fail('numéro de tag multi-octets non supporté');
  }
  if (offset + 2 > limit) {
    fail('en-tête tronqué');
  }
  const firstLength = buffer[offset + 1];
  if (firstLength === undefined) {
    fail('longueur absente');
  }
  let headerLength = 2;
  let length = 0;
  if (firstLength < 0x80) {
    length = firstLength;
  } else {
    const count = firstLength & 0x7f;
    if (count === 0) {
      fail('longueur indéfinie interdite en DER');
    }
    if (count > 4) {
      fail('longueur excessive');
    }
    if (offset + 2 + count > limit) {
      fail('longueur tronquée');
    }
    for (let index = 0; index < count; index += 1) {
      const byte = buffer[offset + 2 + index];
      if (byte === undefined) {
        fail('longueur tronquée');
      }
      length = length * 256 + byte;
    }
    if (length < 0x80) {
      fail('encodage de longueur non minimal');
    }
    headerLength += count;
  }
  const contentStart = offset + headerLength;
  const end = contentStart + length;
  if (end > limit) {
    fail('contenu tronqué');
  }
  return {
    tag,
    constructed: (tag & 0x20) !== 0,
    raw: buffer.subarray(offset, end),
    content: buffer.subarray(contentStart, end),
  };
}

export function derChildren(node: DerNode): DerNode[] {
  if (!node.constructed) {
    fail('un élément primitif ne peut pas avoir d’enfants');
  }
  const children: DerNode[] = [];
  let offset = 0;
  while (offset < node.content.length) {
    const child = readDer(node.content, offset);
    children.push(child);
    offset += child.raw.length;
  }
  return children;
}

export function expectTag(node: DerNode, tag: number, label: string): DerNode {
  if (node.tag !== tag) {
    fail(`${label} : tag 0x${node.tag.toString(16)} au lieu de 0x${tag.toString(16)}`);
  }
  return node;
}

export function expectSequence(node: DerNode, label: string): DerNode {
  return expectTag(node, 0x30, label);
}

export function nodeAt(
  nodes: readonly DerNode[],
  index: number,
  label: string,
): DerNode {
  const node = nodes[index];
  if (node === undefined) {
    fail(`${label} absent`);
  }
  return node;
}

export function decodeOid(node: DerNode): string {
  expectTag(node, 0x06, 'OBJECT IDENTIFIER');
  const bytes = node.content;
  if (bytes.length === 0) {
    fail('OBJECT IDENTIFIER vide');
  }
  const values: number[] = [];
  let value = 0;
  let inProgress = false;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      fail('OBJECT IDENTIFIER tronqué');
    }
    value = value * 128 + (byte & 0x7f);
    inProgress = true;
    if ((byte & 0x80) === 0) {
      values.push(value);
      value = 0;
      inProgress = false;
    }
  }
  if (inProgress) {
    fail('OBJECT IDENTIFIER tronqué');
  }
  const firstValue = values[0];
  if (firstValue === undefined) {
    fail('OBJECT IDENTIFIER vide');
  }
  const firstArc = firstValue < 40 ? 0 : firstValue < 80 ? 1 : 2;
  const secondArc = firstValue - firstArc * 40;
  return [firstArc, secondArc, ...values.slice(1)].join('.');
}

export function decodeInteger(node: DerNode): bigint {
  expectTag(node, 0x02, 'INTEGER');
  const bytes = node.content;
  if (bytes.length === 0) {
    fail('INTEGER vide');
  }
  const first = bytes[0];
  if (first === undefined) {
    fail('INTEGER vide');
  }
  if ((first & 0x80) !== 0) {
    fail('INTEGER négatif interdit');
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

export function decodeBoolean(node: DerNode): boolean {
  expectTag(node, 0x01, 'BOOLEAN');
  const value = node.content[0];
  if (node.content.length !== 1 || value === undefined) {
    fail('BOOLEAN mal encodé');
  }
  return value !== 0x00;
}

export function decodeOctetString(node: DerNode): Buffer {
  expectTag(node, 0x04, 'OCTET STRING');
  return node.content;
}

export function decodeGeneralizedTime(node: DerNode): Date {
  expectTag(node, 0x18, 'GeneralizedTime');
  const text = node.content.toString('ascii');
  const match =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?Z$/.exec(text);
  if (match === null) {
    fail(`GeneralizedTime non canonique : ${text}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const milliseconds = fraction === '' ? 0 : Number(fraction.padEnd(3, '0'));
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, milliseconds),
  );
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== milliseconds
  ) {
    fail(`GeneralizedTime invalide : ${text}`);
  }
  return date;
}

function encodeLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) {
    fail('longueur à encoder invalide');
  }
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  if (bytes.length > 4) {
    fail('longueur à encoder excessive');
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

export function derSequence(parts: readonly Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(parts));
}

export function derInteger(value: bigint): Buffer {
  if (value < 0n) {
    fail('INTEGER négatif interdit');
  }
  if (value === 0n) {
    return derTlv(0x02, Buffer.from([0]));
  }
  const bytes: number[] = [];
  let current = value;
  while (current > 0n) {
    bytes.unshift(Number(current & 0xffn));
    current >>= 8n;
  }
  const first = bytes[0];
  if (first === undefined) {
    fail('INTEGER vide');
  }
  if ((first & 0x80) !== 0) {
    bytes.unshift(0);
  }
  return derTlv(0x02, Buffer.from(bytes));
}

function encodeBase128(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('composante OID invalide');
  }
  const groups = [value & 0x7f];
  let rest = Math.floor(value / 128);
  while (rest > 0) {
    groups.unshift((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  return groups;
}

export function derOid(oid: string): Buffer {
  const parts = oid.split('.');
  if (parts.length < 2) {
    fail(`OID invalide : ${oid}`);
  }
  const arcs = parts.map((part) => {
    if (!/^(?:0|[1-9][0-9]*)$/.test(part)) {
      fail(`OID invalide : ${oid}`);
    }
    return Number(part);
  });
  const first = arcs[0];
  const second = arcs[1];
  if (first === undefined || second === undefined) {
    fail(`OID invalide : ${oid}`);
  }
  if (first > 2 || (first < 2 && second > 39)) {
    fail(`OID invalide : ${oid}`);
  }
  const values = [first * 40 + second, ...arcs.slice(2)];
  const bytes: number[] = [];
  for (const value of values) {
    bytes.push(...encodeBase128(value));
  }
  return derTlv(0x06, Buffer.from(bytes));
}

export function derOctetString(content: Buffer): Buffer {
  return derTlv(0x04, content);
}

export function derBoolean(value: boolean): Buffer {
  return derTlv(0x01, Buffer.from([value ? 0xff : 0x00]));
}
