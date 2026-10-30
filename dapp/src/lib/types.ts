import type { Address, Hex } from "viem";

export type ActivityRecord = {
  owner: Address;
  name: string;
  createdAt: bigint;
  keyEpoch: number;
  keyManifestTxId: Hex;
  keyManifestHash: Hex;
  exists: boolean;
};

export type PhotoRecord = {
  activityId: bigint;
  assetType: number;
  schemaVersion: number;
  photoTxId: Hex;
  metadataTxId: Hex;
  contentHash: Hex;
  metadataHash: Hex;
  capturedAt: bigint;
  publishedAt: bigint;
  publisher: Address;
  keyEpoch: number;
  isTimeCapsule: boolean;
};

export type TimeCapsuleRecord = {
  schemaVersion: number;
  unlockAt: bigint;
  targetRound: number;
  period: number;
  genesisTime: bigint;
  chainHash: Hex;
  publicKey: Hex;
  schemeID: string;
  tlockCiphertextTxId: Hex;
  tlockCiphertextHash: Hex;
  exists: boolean;
};

export type KeyGrant = {
  recipient: Address;
  recipientPublicKey: Hex;
  ephemeralPublicKey: Hex;
  nonce: Hex;
  ciphertext: Hex;
};

export type KeyEpochEntry = {
  epoch: number;
  grants: KeyGrant[];
};

export type KeyManifest = {
  schemaVersion: 2;
  activityId: string;
  activeEpoch: number;
  updatedAt: string;
  keys: KeyEpochEntry[];
};

export type AccountEncryptionRecord = {
  publicKey: Hex;
  kdfSalt: Hex;
  kdfVersion: number;
  schemaVersion: number;
  exists: boolean;
};

export type AccountEncryptionIdentity = {
  publicKey: Hex;
  privateKey: Uint8Array;
};

export type EncryptedMetadataEnvelope = {
  schemaVersion: 2;
  activityId: string;
  keyEpoch: number;
  nonce: Hex;
  ciphertext: Hex;
};

export type PhotoMetadata = {
  schemaVersion: 2;
  assetType: "photo";
  activityId: string;
  capturedAt: string;
  description: string;
  original: {
    mimeType: string;
    byteLength: number;
    sha256: Hex;
    txId: Hex;
  };
  preview: {
    mimeType: string;
    byteLength: number;
    sha256: Hex;
    txId: Hex;
    width: number;
    height: number;
    maxEdge: number;
    quality: number;
  };
  encryption: {
    algorithm: "AES-256-GCM";
    keyEpoch: number;
    originalNonce: Hex;
    previewNonce: Hex;
  };
  timeCapsule?: {
    schemaVersion: 1;
    unlockAt: string;
    targetRound: number;
    chainHash: Hex;
    tlockCiphertextTxId: Hex;
    tlockCiphertextHash: Hex;
  };
};

export type StorageReceipt = {
  txId: Hex;
  mode: "local" | "arweave";
};

export type ActivityMembership = {
  activityId: bigint;
  activity: ActivityRecord;
  canPublish: boolean;
  canView: boolean;
};
