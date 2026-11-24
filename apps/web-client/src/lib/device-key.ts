/**
 * D71 / SEC-AUTH-001 (client web) : clé d'appareil Ed25519 générée par le
 * navigateur (WebCrypto). La clé privée est NON EXPORTABLE : aucun script ne
 * peut en lire les octets, seulement la faire signer. Elle est conservée dans
 * IndexedDB (un objet CryptoKey y est stocké tel quel, sans sérialisation des
 * octets). La clé publique part au serveur en SPKI base64, comme pour le mobile.
 * Navigateur sans Ed25519 : `DEVICE_KEY_UNSUPPORTED`, rien n'est simulé.
 */
export type StoredDeviceKey = {
  readonly deviceId: string;
  readonly privateKey: CryptoKey;
};

export type DeviceKeyStore = {
  readonly load: () => Promise<StoredDeviceKey | null>;
  readonly save: (record: StoredDeviceKey) => Promise<void>;
  readonly clear: () => Promise<void>;
};

export type GeneratedDeviceKey = {
  readonly privateKey: CryptoKey;
  /** SPKI DER en base64 standard (format attendu par `POST /v1/auth/signups`). */
  readonly publicKeySpki: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function generateDeviceKey(subtle: SubtleCrypto = crypto.subtle): Promise<GeneratedDeviceKey> {
  let pair: CryptoKeyPair;
  try {
    pair = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  } catch {
    throw new Error('DEVICE_KEY_UNSUPPORTED');
  }
  if (pair.privateKey.extractable) throw new Error('DEVICE_KEY_UNSUPPORTED');
  return { privateKey: pair.privateKey, publicKeySpki: toBase64(await subtle.exportKey('spki', pair.publicKey)) };
}

/** Signature Ed25519 (64 octets) en base64 standard, format attendu par les routes de session. */
export function deviceSigner(privateKey: CryptoKey, subtle: SubtleCrypto = crypto.subtle): (message: Uint8Array) => Promise<string> {
  // Copie dans un tampon propre (le type BufferSource refuse un Uint8Array adossé à un SharedArrayBuffer).
  return async (message) => toBase64(await subtle.sign({ name: 'Ed25519' }, privateKey, new Uint8Array(message)));
}

const DATABASE = 'molopay-device';
const STORE = 'device-key';
const RECORD = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error('DEVICE_KEY_STORE_UNAVAILABLE')); };
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('DEVICE_KEY_STORE_UNAVAILABLE')); };
  }));
}

/** Stockage réel (IndexedDB) : un seul appareil enrôlé par navigateur et par origine. */
export function indexedDbDeviceKeyStore(): DeviceKeyStore {
  return {
    async load() {
      const value: unknown = await run('readonly', (store) => store.get(RECORD) as IDBRequest<unknown>);
      if (typeof value !== 'object' || value === null) return null;
      const record = value as { deviceId?: unknown; privateKey?: unknown };
      if (typeof record.deviceId !== 'string' || !UUID.test(record.deviceId) || !(record.privateKey instanceof CryptoKey)) return null;
      return { deviceId: record.deviceId, privateKey: record.privateKey };
    },
    async save(record) {
      if (!UUID.test(record.deviceId) || record.privateKey.extractable) throw new Error('DEVICE_KEY_INVALID');
      await run('readwrite', (store) => store.put({ deviceId: record.deviceId, privateKey: record.privateKey }, RECORD));
    },
    async clear() {
      await run('readwrite', (store) => store.delete(RECORD));
    },
  };
}
