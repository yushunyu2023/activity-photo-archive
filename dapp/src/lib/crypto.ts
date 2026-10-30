import { x25519 } from "@noble/curves/ed25519.js";
import { argon2idAsync } from "@noble/hashes/argon2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";
import { canonicalJson, utf8 } from "@/lib/canonical-json";
import type {
  AccountEncryptionIdentity,
  AccountEncryptionRecord,
  EncryptedMetadataEnvelope,
  KeyGrant,
  PhotoMetadata,
} from "@/lib/types";

export const ACCOUNT_KDF_VERSION = 1;
export const ACCOUNT_ENCRYPTION_SCHEMA_VERSION = 1;

const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
// @noble/hashes limits Argon2 memory by 32-bit words, not bytes.
const ARGON2_MAX_MEMORY_WORDS = (64 * 1024 * 1024) / 4;

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function isHexBytes(value: unknown, byteLength: number): value is Hex {
  return (
    typeof value === "string" &&
    new RegExp(`^0x[0-9a-fA-F]{${byteLength * 2}}$`).test(value)
  );
}

export function isAccountEncryptionRecord(
  value: unknown,
): value is AccountEncryptionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AccountEncryptionRecord>;
  return (
    isHexBytes(record.publicKey, 32) &&
    isHexBytes(record.kdfSalt, 16) &&
    Number.isInteger(record.kdfVersion) &&
    record.kdfVersion === ACCOUNT_KDF_VERSION &&
    Number.isInteger(record.schemaVersion) &&
    record.schemaVersion === ACCOUNT_ENCRYPTION_SCHEMA_VERSION &&
    record.exists === true
  );
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(rawKey), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function deriveAesKey(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(inputKeyMaterial),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(utf8(info)),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptWithKey(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: string,
): Promise<{ nonce: Hex; ciphertext: Hex }> {
  const nonce = randomBytes(12);
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: toArrayBuffer(nonce),
  };
  if (additionalData) {
    algorithm.additionalData = toArrayBuffer(utf8(additionalData));
  }
  const ciphertext = await crypto.subtle.encrypt(
    algorithm,
    key,
    toArrayBuffer(plaintext),
  );

  return {
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  };
}

async function decryptWithKey(
  key: CryptoKey,
  ciphertext: Hex,
  nonce: Hex,
  additionalData?: string,
): Promise<Uint8Array> {
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: toArrayBuffer(hexToBytes(nonce)),
  };
  if (additionalData) {
    algorithm.additionalData = toArrayBuffer(utf8(additionalData));
  }
  const plaintext = await crypto.subtle.decrypt(
    algorithm,
    key,
    toArrayBuffer(hexToBytes(ciphertext)),
  );

  return new Uint8Array(plaintext);
}

export async function sha256Hex(data: Uint8Array): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return bytesToHex(new Uint8Array(digest));
}

export function generateAccountEncryptionSalt(): Hex {
  return bytesToHex(randomBytes(16));
}

export async function deriveAccountEncryptionIdentity({
  password,
  kdfSalt,
  chainId,
  registryAddress,
  walletAddress,
  kdfVersion = ACCOUNT_KDF_VERSION,
}: {
  password: string;
  kdfSalt: Hex;
  chainId: number;
  registryAddress: Address;
  walletAddress: Address;
  kdfVersion?: number;
}): Promise<AccountEncryptionIdentity> {
  if (kdfVersion !== ACCOUNT_KDF_VERSION) {
    throw new Error(`不支持的安全密码版本：${kdfVersion}`);
  }
  if (!isHexBytes(kdfSalt, 16)) {
    throw new Error("安全密码参数无效");
  }

  let seed: Uint8Array | null = null;
  let privateKey: Uint8Array | null = null;
  try {
    seed = await argon2idAsync(
      utf8(password.normalize("NFC")),
      hexToBytes(kdfSalt),
      {
        t: ARGON2_ITERATIONS,
        m: ARGON2_MEMORY_KIB,
        p: ARGON2_PARALLELISM,
        dkLen: 32,
        maxmem: ARGON2_MAX_MEMORY_WORDS,
        asyncTick: 10,
      },
    );
    const info = utf8(
      [
        "activity-photo-account-x25519-v1",
        chainId,
        registryAddress.toLowerCase(),
        walletAddress.toLowerCase(),
        kdfVersion,
      ].join("|"),
    );
    privateKey = hkdf(sha256, seed, undefined, info, 32);
    const keyPair = x25519.keygen(privateKey);
    return {
      publicKey: bytesToHex(keyPair.publicKey),
      privateKey: new Uint8Array(keyPair.secretKey),
    };
  } finally {
    seed?.fill(0);
    privateKey?.fill(0);
  }
}

export function wipeBytes(value: Uint8Array | null | undefined): void {
  value?.fill(0);
}

export async function wrapActivityKey(
  activityKey: Uint8Array,
  recipientPublicKey: Hex,
  recipient: Address,
  activityId: string,
  epoch: number,
): Promise<KeyGrant> {
  const ephemeral = x25519.keygen();
  const sharedSecret = x25519.getSharedSecret(ephemeral.secretKey, hexToBytes(recipientPublicKey));
  const grantAad = `activity-key-grant-v2:${activityId}:${epoch}:${recipient.toLowerCase()}:${recipientPublicKey.toLowerCase()}`;
  const wrappingKey = await deriveAesKey(
    sharedSecret,
    utf8("activity-photo-key-wrap-v2"),
    `${activityId}:${epoch}`,
  );
  const encrypted = await encryptWithKey(wrappingKey, activityKey, grantAad);
  sharedSecret.fill(0);

  return {
    recipient,
    recipientPublicKey,
    ephemeralPublicKey: bytesToHex(ephemeral.publicKey),
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
  };
}

export async function unwrapActivityKey(
  grant: KeyGrant,
  accountPrivateKey: Uint8Array,
  activityId: string,
  epoch: number,
): Promise<Uint8Array> {
  const actualPublicKey = bytesToHex(x25519.getPublicKey(accountPrivateKey));
  if (actualPublicKey.toLowerCase() !== grant.recipientPublicKey.toLowerCase()) {
    throw new Error("该代际授权属于当前地址的另一个安全密码，无法解密");
  }
  const sharedSecret = x25519.getSharedSecret(
    accountPrivateKey,
    hexToBytes(grant.ephemeralPublicKey),
  );
  const grantAad = `activity-key-grant-v2:${activityId}:${epoch}:${grant.recipient.toLowerCase()}:${grant.recipientPublicKey.toLowerCase()}`;
  const wrappingKey = await deriveAesKey(
    sharedSecret,
    utf8("activity-photo-key-wrap-v2"),
    `${activityId}:${epoch}`,
  );
  try {
    return await decryptWithKey(wrappingKey, grant.ciphertext, grant.nonce, grantAad);
  } finally {
    sharedSecret.fill(0);
  }
}

export async function derivePhotoKey(
  activityKey: Uint8Array,
  activityId: string,
  epoch: number,
  contentHash: Hex,
): Promise<CryptoKey> {
  return deriveAesKey(
    activityKey,
    utf8("activity-photo-content-v2"),
    `${activityId}:${epoch}:${contentHash}`,
  );
}

export function photoAad(
  activityId: string,
  epoch: number,
  contentHash: Hex,
  kind: "photo" | "preview" | "metadata",
): string {
  return `activity-photo-v2:${activityId}:${epoch}:${contentHash}:${kind}`;
}

export async function encryptPhotoBytes(
  key: CryptoKey,
  bytes: Uint8Array,
  activityId: string,
  epoch: number,
  contentHash: Hex,
  kind: "photo" | "preview",
): Promise<{ nonce: Hex; ciphertext: Uint8Array }> {
  const encrypted = await encryptWithKey(
    key,
    bytes,
    photoAad(activityId, epoch, contentHash, kind),
  );

  return {
    nonce: encrypted.nonce,
    ciphertext: hexToBytes(encrypted.ciphertext),
  };
}

export async function decryptPhotoBytes(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Hex,
  activityId: string,
  epoch: number,
  contentHash: Hex,
  kind: "photo" | "preview",
): Promise<Uint8Array> {
  return decryptWithKey(
    key,
    bytesToHex(ciphertext),
    nonce,
    photoAad(activityId, epoch, contentHash, kind),
  );
}

export async function encryptMetadata(
  key: CryptoKey,
  metadata: PhotoMetadata,
  nonce: Hex,
  activityId: string,
  epoch: number,
  contentHash: Hex,
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(hexToBytes(nonce)),
      additionalData: toArrayBuffer(utf8(photoAad(activityId, epoch, contentHash, "metadata"))),
    },
    key,
    toArrayBuffer(utf8(canonicalJson(metadata))),
  );

  return new Uint8Array(ciphertext);
}

export async function decryptMetadata(
  key: CryptoKey,
  envelope: EncryptedMetadataEnvelope,
  contentHash: Hex,
): Promise<PhotoMetadata> {
  const plaintext = await decryptWithKey(
    key,
    envelope.ciphertext,
    envelope.nonce,
    photoAad(envelope.activityId, envelope.keyEpoch, contentHash, "metadata"),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as PhotoMetadata;
}

export function newNonce(): Hex {
  return bytesToHex(randomBytes(12));
}

export function generateActivityKey(): Uint8Array {
  return randomBytes(32);
}
