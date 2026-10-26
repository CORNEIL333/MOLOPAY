import {
  createHash,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  X509Certificate,
} from 'node:crypto';
import { rootCertificates } from 'node:tls';
import {
  decodeBoolean,
  decodeGeneralizedTime,
  decodeInteger,
  decodeOctetString,
  decodeOid,
  derBoolean,
  derChildren,
  derInteger,
  derOctetString,
  derOid,
  derSequence,
  derTlv,
  expectSequence,
  expectTag,
  nodeAt,
  readDer,
  type DerNode,
} from './der';
import { ChainError } from './errors';
import { canonicalTreeHead, type TreeHead } from './sth';

export const DEFAULT_TSA_URL = 'http://timestamp.digicert.com';

const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_EKU = '2.5.29.37';
const OID_EKU_TIMESTAMPING = '1.3.6.1.5.5.7.3.8';
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';

const SIGNATURE_HASH_ALGORITHMS: Readonly<Record<string, string>> = {
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
  '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384',
  '1.2.840.10045.4.3.4': 'sha512',
};

const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SKEW_MS = 10 * 60 * 1000;

const SHA256_ALGORITHM = derSequence([
  derOid(OID_SHA256),
  derTlv(0x05, Buffer.alloc(0)),
]);

export type TimeStampOptions = {
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly maxSkewMs?: number | undefined;
  readonly now?: () => Date;
};

export type TimeStampExpectation = {
  readonly hashedMessage: Buffer;
  readonly nonce: bigint;
  readonly now?: Date;
  readonly maxSkewMs?: number | undefined;
};

export type TimeStampResult = {
  readonly genTime: string;
  readonly policyOid: string;
  readonly serialNumber: string;
  readonly nonce: bigint;
  readonly hashedMessage: Buffer;
  readonly tsaCertificateSha256: string;
  readonly tokenDer: Buffer;
};

export type TimeStampedTreeHead = {
  readonly head: TreeHead;
  readonly timestamp: TimeStampResult;
};

type ParsedCertificate = {
  readonly der: Buffer;
  readonly cert: X509Certificate;
  readonly fields: readonly DerNode[];
  readonly serial: bigint;
  readonly issuerRaw: Buffer;
};

function fail(message: string): never {
  throw new ChainError('TIMESTAMP_INVALID', message);
}

export function generateTimeStampNonce(): bigint {
  for (;;) {
    const nonce = BigInt(`0x${randomBytes(16).toString('hex')}`);
    if (nonce !== 0n) {
      return nonce;
    }
  }
}

export function buildTimeStampRequest(
  hashedMessage: Buffer,
  nonce: bigint,
): Buffer {
  if (hashedMessage.length !== 32) {
    fail('empreinte SHA-256 de 32 octets attendue');
  }
  if (nonce <= 0n) {
    fail('nonce strictement positif attendu');
  }
  return derSequence([
    derInteger(1n),
    derSequence([SHA256_ALGORITHM, derOctetString(hashedMessage)]),
    derInteger(nonce),
    derBoolean(true),
  ]);
}

export async function requestTimeStamp(
  hashedMessage: Buffer,
  nonce: bigint,
  options: TimeStampOptions = {},
): Promise<TimeStampResult> {
  const url = options.url ?? DEFAULT_TSA_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    fail('délai d’attente TSA invalide');
  }
  const request = buildTimeStampRequest(hashedMessage, nonce);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        Accept: 'application/timestamp-reply',
      },
      body: request,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    fail(
      `TSA injoignable (${url}) : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    fail(`TSA a répondu HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/timestamp-reply(?:\s*;|$)/i.test(contentType)) {
    fail(`content-type TSA inattendu : ${contentType || 'absent'}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > MAX_RESPONSE_BYTES) {
    fail(`taille de réponse TSA invalide : ${body.length}`);
  }
  return parseTimeStampResponse(body, {
    hashedMessage,
    nonce,
    now: options.now?.() ?? new Date(),
    maxSkewMs: options.maxSkewMs,
  });
}

export async function timestampTreeHead(
  head: TreeHead,
  options: TimeStampOptions = {},
): Promise<TimeStampedTreeHead> {
  const hashedMessage = createHash('sha256')
    .update(canonicalTreeHead(head), 'utf8')
    .digest();
  const nonce = generateTimeStampNonce();
  const timestamp = await requestTimeStamp(hashedMessage, nonce, options);
  return Object.freeze({ head, timestamp });
}

export function parseTimeStampResponse(
  responseDer: Buffer,
  expected: TimeStampExpectation,
): TimeStampResult {
  const response = expectSequence(readDer(responseDer), 'TimeStampResp');
  if (response.raw.length !== responseDer.length) {
    fail('octets excédentaires après TimeStampResp');
  }
  const responseFields = derChildren(response);
  const statusInfo = expectSequence(
    nodeAt(responseFields, 0, 'PKIStatusInfo'),
    'PKIStatusInfo',
  );
  const status = decodeInteger(
    nodeAt(derChildren(statusInfo), 0, 'PKIStatus'),
  );
  if (status !== 0n && status !== 1n) {
    fail(`TSA a refusé la requête (statut ${status.toString()})`);
  }
  const token = nodeAt(responseFields, 1, 'TimeStampToken');
  if (responseFields.length > 2) {
    fail('champs excédentaires dans TimeStampResp');
  }
  return parseTimeStampToken(token.raw, expected);
}

export function parseTimeStampToken(
  tokenDer: Buffer,
  expected: TimeStampExpectation,
): TimeStampResult {
  if (expected.hashedMessage.length !== 32) {
    fail('empreinte SHA-256 de 32 octets attendue');
  }
  const contentInfo = expectTag(readDer(tokenDer), 0x30, 'TimeStampToken');
  if (contentInfo.raw.length !== tokenDer.length) {
    fail('octets excédentaires après TimeStampToken');
  }
  const contentInfoFields = derChildren(contentInfo);
  if (decodeOid(nodeAt(contentInfoFields, 0, 'contentType')) !== OID_SIGNED_DATA) {
    fail('TimeStampToken n’est pas un SignedData CMS');
  }
  const explicitContent = expectTag(
    nodeAt(contentInfoFields, 1, 'content SignedData'),
    0xa0,
    'SignedData [0]',
  );
  const signedData = expectSequence(readDer(explicitContent.content), 'SignedData');
  if (signedData.raw.length !== explicitContent.content.length) {
    fail('octets excédentaires dans SignedData');
  }

  const signedDataFields = derChildren(signedData);
  const signedDataVersion = decodeInteger(
    nodeAt(signedDataFields, 0, 'version SignedData'),
  );
  if (signedDataVersion < 1n) {
    fail('version SignedData invalide');
  }
  const digestAlgorithms = derChildren(
    expectTag(nodeAt(signedDataFields, 1, 'digestAlgorithms'), 0x31, 'digestAlgorithms'),
  ).map((algorithm) =>
    decodeOid(
      nodeAt(derChildren(expectSequence(algorithm, 'AlgorithmIdentifier')), 0, 'digestAlgorithm'),
    ),
  );
  if (!digestAlgorithms.includes(OID_SHA256)) {
    fail('SignedData ne déclare pas SHA-256');
  }

  const encapsulated = expectSequence(
    nodeAt(signedDataFields, 2, 'encapContentInfo'),
    'EncapsulatedContentInfo',
  );
  const encapsulatedFields = derChildren(encapsulated);
  if (decodeOid(nodeAt(encapsulatedFields, 0, 'eContentType')) !== OID_TST_INFO) {
    fail('contenu encapsulé différent de TSTInfo');
  }
  const eContentWrapper = expectTag(
    nodeAt(encapsulatedFields, 1, 'eContent'),
    0xa0,
    'eContent [0]',
  );
  const eContentOctets = expectTag(
    readDer(eContentWrapper.content),
    0x04,
    'eContent OCTET STRING',
  );
  if (eContentOctets.raw.length !== eContentWrapper.content.length) {
    fail('octets excédentaires dans eContent');
  }
  const tstInfoDer = eContentOctets.content;

  let certificatesNode: DerNode | null = null;
  let signerInfosNode: DerNode | null = null;
  for (const field of signedDataFields.slice(3)) {
    if (field.tag === 0xa0) {
      if (certificatesNode !== null) {
        fail('certificats CMS dupliqués');
      }
      certificatesNode = field;
    } else if (field.tag === 0xa1) {
      continue;
    } else if (field.tag === 0x31) {
      if (signerInfosNode !== null) {
        fail('signerInfos dupliqués');
      }
      signerInfosNode = field;
    } else {
      fail(`champ SignedData inattendu (tag 0x${field.tag.toString(16)})`);
    }
  }
  if (signerInfosNode === null) {
    fail('signerInfos absent');
  }
  const signerInfos = derChildren(signerInfosNode);
  if (signerInfos.length !== 1) {
    fail('un unique SignerInfo est attendu pour un jeton TSA');
  }
  const signerInfo = nodeAt(signerInfos, 0, 'SignerInfo');
  const signerFields = derChildren(signerInfo);
  const signerVersion = decodeInteger(nodeAt(signerFields, 0, 'version SignerInfo'));
  if (signerVersion < 1n) {
    fail('version SignerInfo invalide');
  }
  const sid = nodeAt(signerFields, 1, 'sid');
  const signerDigestAlgorithm = expectSequence(
    nodeAt(signerFields, 2, 'digestAlgorithm SignerInfo'),
    'digestAlgorithm',
  );
  if (
    decodeOid(nodeAt(derChildren(signerDigestAlgorithm), 0, 'digestAlgorithm OID')) !==
    OID_SHA256
  ) {
    fail('SignerInfo n’utilise pas SHA-256');
  }
  const signedAttrs = expectTag(
    nodeAt(signerFields, 3, 'signedAttrs'),
    0xa0,
    'signedAttrs [0]',
  );
  const signatureAlgorithm = decodeOid(
    nodeAt(
      derChildren(
        expectSequence(
          nodeAt(signerFields, 4, 'signatureAlgorithm'),
          'signatureAlgorithm',
        ),
      ),
      0,
      'signatureAlgorithm OID',
    ),
  );
  const signatureHash =
    signatureAlgorithm === OID_RSA_ENCRYPTION
      ? 'sha256'
      : SIGNATURE_HASH_ALGORITHMS[signatureAlgorithm];
  if (signatureHash === undefined) {
    fail(`algorithme de signature TSA non supporté : ${signatureAlgorithm}`);
  }
  const signature = decodeOctetString(
    nodeAt(signerFields, 5, 'signature'),
  );
  if (signerFields.length > 6) {
    expectTag(nodeAt(signerFields, 6, 'unsignedAttrs'), 0xa1, 'unsignedAttrs [1]');
    if (signerFields.length > 7) {
      fail('champs excédentaires dans SignerInfo');
    }
  }

  const signedAttrsForSignature = Buffer.from(signedAttrs.raw);
  signedAttrsForSignature[0] = 0x31;
  let messageDigest: Buffer | null = null;
  let signedContentType: string | null = null;
  for (const attribute of derChildren(signedAttrs)) {
    const attributeFields = derChildren(
      expectSequence(attribute, 'Attribute'),
    );
    const attributeOid = decodeOid(nodeAt(attributeFields, 0, 'Attribute OID'));
    const values = derChildren(
      expectTag(nodeAt(attributeFields, 1, 'Attribute values'), 0x31, 'SET OF'),
    );
    if (values.length !== 1) {
      fail(`attribut CMS multivalué : ${attributeOid}`);
    }
    const value = nodeAt(values, 0, 'Attribute value');
    if (attributeOid === OID_MESSAGE_DIGEST) {
      if (messageDigest !== null) {
        fail('messageDigest dupliqué');
      }
      messageDigest = decodeOctetString(value);
    } else if (attributeOid === OID_CONTENT_TYPE) {
      signedContentType = decodeOid(value);
    }
  }
  if (messageDigest === null) {
    fail('attribut messageDigest absent');
  }
  if (signedContentType !== OID_TST_INFO) {
    fail('attribut contentType différent de TSTInfo');
  }
  if (messageDigest.length !== 32) {
    fail('messageDigest CMS de taille invalide');
  }
  const tstInfoDigest = createHash('sha256').update(tstInfoDer).digest();
  if (!timingSafeEqual(tstInfoDigest, messageDigest)) {
    fail('messageDigest CMS incohérent avec TSTInfo');
  }

  const tstInfo = expectSequence(readDer(tstInfoDer), 'TSTInfo');
  if (tstInfo.raw.length !== tstInfoDer.length) {
    fail('octets excédentaires après TSTInfo');
  }
  const tstInfoFields = derChildren(tstInfo);
  if (decodeInteger(nodeAt(tstInfoFields, 0, 'version TSTInfo')) !== 1n) {
    fail('version TSTInfo différente de 1');
  }
  const policyOid = decodeOid(nodeAt(tstInfoFields, 1, 'policy'));
  const messageImprint = expectSequence(
    nodeAt(tstInfoFields, 2, 'messageImprint'),
    'MessageImprint',
  );
  const messageImprintFields = derChildren(messageImprint);
  const imprintAlgorithm = expectSequence(
    nodeAt(messageImprintFields, 0, 'messageImprint algorithm'),
    'AlgorithmIdentifier',
  );
  if (
    decodeOid(nodeAt(derChildren(imprintAlgorithm), 0, 'imprint hash OID')) !==
    OID_SHA256
  ) {
    fail('messageImprint TSA différent de SHA-256');
  }
  const printedMessage = decodeOctetString(
    nodeAt(messageImprintFields, 1, 'hashedMessage'),
  );
  if (
    printedMessage.length !== expected.hashedMessage.length ||
    !timingSafeEqual(printedMessage, expected.hashedMessage)
  ) {
    fail('messageImprint TSA différent de l’empreinte attendue');
  }
  const serialNumber = decodeInteger(
    nodeAt(tstInfoFields, 3, 'serialNumber'),
  ).toString(16);
  const genTime = decodeGeneralizedTime(
    nodeAt(tstInfoFields, 4, 'genTime'),
  );
  let nonce: bigint | null = null;
  for (const field of tstInfoFields.slice(5)) {
    if (field.tag === 0x02) {
      if (nonce !== null) {
        fail('nonce TSTInfo dupliqué');
      }
      nonce = decodeInteger(field);
    } else if (field.tag === 0x01) {
      decodeBoolean(field);
    }
  }
  if (nonce === null) {
    fail('nonce absent de TSTInfo');
  }
  if (nonce !== expected.nonce) {
    fail('nonce TSTInfo différent du nonce envoyé');
  }
  const now = expected.now ?? new Date();
  const maxSkewMs = expected.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now.getTime() - genTime.getTime()) > maxSkewMs) {
    fail(`genTime TSA hors tolérance : ${genTime.toISOString()}`);
  }

  const certificates: ParsedCertificate[] = [];
  if (certificatesNode !== null) {
    for (const choice of derChildren(certificatesNode)) {
      if (choice.tag !== 0x30) {
        continue;
      }
      const cert = tryParseCertificate(choice.raw);
      if (cert !== null) {
        certificates.push(cert);
      }
    }
  }
  const signer = selectSignerCertificate(certificates, sid, signature, {
    hash: signatureHash,
    data: signedAttrsForSignature,
  });
  if (signer.cert.ca) {
    fail('certificat signataire TSA marqué CA');
  }
  if (!hasTimeStampingEku(signer.fields)) {
    fail('certificat signataire TSA sans EKU horodatage');
  }
  verifyCertificateChain(signer, certificates, genTime);

  return Object.freeze({
    genTime: genTime.toISOString(),
    policyOid,
    serialNumber,
    nonce,
    hashedMessage: Buffer.from(printedMessage),
    tsaCertificateSha256: createHash('sha256').update(signer.der).digest('hex'),
    tokenDer: Buffer.from(tokenDer),
  });
}

function tryParseCertificate(der: Buffer): ParsedCertificate | null {
  try {
    const certificate = expectSequence(readDer(der), 'Certificate');
    const certificateFields = derChildren(certificate);
    const tbsCertificate = expectSequence(
      nodeAt(certificateFields, 0, 'TBSCertificate'),
      'TBSCertificate',
    );
    const fields = derChildren(tbsCertificate);
    const versionOffset = fields[0]?.tag === 0xa0 ? 1 : 0;
    const serial = decodeInteger(
      nodeAt(fields, versionOffset, 'certificat serialNumber'),
    );
    const issuer = expectSequence(
      nodeAt(fields, versionOffset + 2, 'certificat issuer'),
      'certificat issuer',
    );
    return {
      der,
      cert: new X509Certificate(der),
      fields,
      serial,
      issuerRaw: issuer.raw,
    };
  } catch {
    return null;
  }
}

function verifySignature(
  hash: string,
  data: Buffer,
  certificate: X509Certificate,
  signature: Buffer,
): boolean {
  try {
    return cryptoVerify(hash, data, certificate.publicKey, signature);
  } catch {
    return false;
  }
}

function selectSignerCertificate(
  certificates: readonly ParsedCertificate[],
  sid: DerNode,
  signature: Buffer,
  signed: { readonly hash: string; readonly data: Buffer },
): ParsedCertificate {
  if (sid.tag === 0x30) {
    const sidFields = derChildren(sid);
    const issuer = expectSequence(
      nodeAt(sidFields, 0, 'sid issuer'),
      'sid issuer',
    );
    const serial = decodeInteger(nodeAt(sidFields, 1, 'sid serialNumber'));
    const matches = certificates.filter(
      (candidate) =>
        candidate.serial === serial && candidate.issuerRaw.equals(issuer.raw),
    );
    if (matches.length !== 1) {
      fail('certificat signataire TSA introuvable ou ambigu');
    }
    const signer = matches[0];
    if (signer === undefined) {
      fail('certificat signataire TSA introuvable ou ambigu');
    }
    if (!verifySignature(signed.hash, signed.data, signer.cert, signature)) {
      fail('signature CMS du jeton TSA invalide');
    }
    return signer;
  }
  if (sid.tag === 0x80) {
    const matches = certificates.filter((candidate) =>
      verifySignature(signed.hash, signed.data, candidate.cert, signature),
    );
    if (matches.length !== 1) {
      fail('signataire TSA par SubjectKeyIdentifier introuvable ou ambigu');
    }
    const signer = matches[0];
    if (signer === undefined) {
      fail('signataire TSA par SubjectKeyIdentifier introuvable ou ambigu');
    }
    return signer;
  }
  fail(`identifiant de signataire CMS non supporté (tag 0x${sid.tag.toString(16)})`);
}

function hasTimeStampingEku(fields: readonly DerNode[]): boolean {
  for (const field of fields) {
    if (field.tag !== 0xa3) {
      continue;
    }
    const extensions = expectSequence(readDer(field.content), 'Extensions');
    for (const extension of derChildren(extensions)) {
      const parts = derChildren(expectSequence(extension, 'Extension'));
      if (decodeOid(nodeAt(parts, 0, 'Extension extnID')) !== OID_EKU) {
        continue;
      }
      const valueIndex = parts[1]?.tag === 0x01 ? 2 : 1;
      const value = expectTag(
        nodeAt(parts, valueIndex, 'Extension extnValue'),
        0x04,
        'Extension extnValue',
      );
      const usages = expectSequence(readDer(value.content), 'ExtKeyUsageSyntax');
      return derChildren(usages).some(
        (usage) => decodeOid(usage) === OID_EKU_TIMESTAMPING,
      );
    }
  }
  return false;
}

function certificateValidity(certificate: X509Certificate): {
  readonly from: number;
  readonly to: number;
} {
  return {
    from: Date.parse(certificate.validFrom),
    to: Date.parse(certificate.validTo),
  };
}

function issuedBy(
  certificate: X509Certificate,
  issuer: X509Certificate,
): boolean {
  try {
    return (
      certificate.checkIssued(issuer) &&
      certificate.verify(issuer.publicKey)
    );
  } catch {
    return false;
  }
}

let trustedRootsCache: readonly X509Certificate[] | null = null;

function trustedRoots(): readonly X509Certificate[] {
  if (trustedRootsCache === null) {
    const roots: X509Certificate[] = [];
    for (const pem of rootCertificates) {
      try {
        roots.push(new X509Certificate(pem));
      } catch {
        continue;
      }
    }
    trustedRootsCache = roots;
  }
  return trustedRootsCache;
}

function verifyCertificateChain(
  leaf: ParsedCertificate,
  embedded: readonly ParsedCertificate[],
  at: Date,
): void {
  const anchors = trustedRoots();
  if (anchors.length === 0) {
    fail('aucune racine de confiance TLS disponible');
  }
  let current = leaf;
  const visited = new Set<string>([
    createHash('sha256').update(current.der).digest('hex'),
  ]);
  for (let depth = 0; depth < 8; depth += 1) {
    const validity = certificateValidity(current.cert);
    if (
      !Number.isFinite(validity.from) ||
      !Number.isFinite(validity.to) ||
      at.getTime() < validity.from ||
      at.getTime() > validity.to
    ) {
      fail('certificat TSA hors période de validité');
    }
    if (anchors.some((anchor) => current.der.equals(anchor.raw))) {
      return;
    }
    const directAnchor = anchors.find((anchor) =>
      issuedBy(current.cert, anchor),
    );
    if (directAnchor !== undefined) {
      return;
    }
    const issuer = embedded.find(
      (candidate) =>
        !candidate.der.equals(current.der) &&
        issuedBy(current.cert, candidate.cert),
    );
    if (issuer === undefined) {
      fail('chaîne de certificats TSA incomplète');
    }
    if (issuer.cert.ca !== true) {
      fail('émetteur TSA non marqué CA');
    }
    const fingerprint = createHash('sha256').update(issuer.der).digest('hex');
    if (visited.has(fingerprint)) {
      fail('boucle dans la chaîne de certificats TSA');
    }
    visited.add(fingerprint);
    current = issuer;
  }
  fail('chaîne de certificats TSA trop profonde');
}
