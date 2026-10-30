import {
  bytesToHex,
  hexToBytes,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { canonicalJson, parseCanonicalJson, utf8 } from "@/lib/canonical-json";
import {
  sha256Hex,
  unwrapActivityKey,
  wrapActivityKey,
} from "@/lib/crypto";
import { fetchEncryptedBytes, uploadEncryptedBytes } from "@/lib/storage";
import type {
  ActivityRecord,
  KeyEpochEntry,
  KeyGrant,
  KeyManifest,
} from "@/lib/types";

function isHexBytes(value: unknown, byteLength: number): value is Hex {
  return (
    typeof value === "string" &&
    new RegExp(`^0x[0-9a-fA-F]{${byteLength * 2}}$`).test(value)
  );
}

export function isKeyManifest(value: unknown): value is KeyManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<KeyManifest>;
  const activeEpoch = manifest.activeEpoch;
  if (
    manifest.schemaVersion !== 2 ||
    typeof manifest.activityId !== "string" ||
    !/^[1-9]\d*$/.test(manifest.activityId) ||
    !Number.isInteger(activeEpoch) ||
    activeEpoch === undefined ||
    activeEpoch < 1 ||
    typeof manifest.updatedAt !== "string" ||
    !Array.isArray(manifest.keys) ||
    manifest.keys.length > 256
  ) {
    return false;
  }

  const epochs = new Set<number>();
  for (const entry of manifest.keys) {
    if (
      !entry ||
      !Number.isInteger(entry.epoch) ||
      entry.epoch < 1 ||
      epochs.has(entry.epoch) ||
      !Array.isArray(entry.grants) ||
      entry.grants.length > 4096
    ) {
      return false;
    }
    epochs.add(entry.epoch);

    const recipients = new Set<string>();
    for (const grant of entry.grants) {
      if (
        !grant ||
        !isAddress(grant.recipient) ||
        recipients.has(grant.recipient.toLowerCase()) ||
        !isHexBytes(grant.recipientPublicKey, 32) ||
        !isHexBytes(grant.ephemeralPublicKey, 32) ||
        !isHexBytes(grant.nonce, 12) ||
        !isHexBytes(grant.ciphertext, 48)
      ) {
        return false;
      }
      recipients.add(grant.recipient.toLowerCase());
    }
  }

  return epochs.has(activeEpoch);
}

export function findGrant(
  manifest: KeyManifest,
  account: Address,
  epoch: number,
  accountPublicKey?: Hex,
): KeyGrant | undefined {
  return manifest.keys
    .find((entry) => entry.epoch === epoch)
    ?.grants.find(
      (grant) =>
        grant.recipient.toLowerCase() === account.toLowerCase() &&
        (!accountPublicKey ||
          grant.recipientPublicKey.toLowerCase() === accountPublicKey.toLowerCase()),
    );
}

export function listGrantedEpochs(
  manifest: KeyManifest,
  account: Address,
  accountPublicKey: Hex,
): number[] {
  return manifest.keys
    .filter((entry) => findGrant(manifest, account, entry.epoch, accountPublicKey))
    .map((entry) => entry.epoch)
    .sort((left, right) => left - right);
}

export function listMissingEpochs(
  currentEpoch: number,
  grantedEpochs: number[],
): number[] {
  const granted = new Set(grantedEpochs);
  return Array.from({ length: currentEpoch }, (_, index) => index + 1).filter(
    (epoch) => !granted.has(epoch),
  );
}

export function formatEpochList(epochs: number[]): string {
  if (!epochs.length) return "无";
  const sorted = [...new Set(epochs)].sort((left, right) => left - right);
  const ranges: string[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (
      index + 1 < sorted.length &&
      sorted[index + 1] === end + 1
    ) {
      end = sorted[index + 1];
      index += 1;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
  }

  return ranges.join("、");
}

export async function decryptManifestKeys(
  manifest: KeyManifest,
  account: Address,
  accountPrivateKey: Uint8Array,
  accountPublicKey?: Hex,
): Promise<Map<number, Uint8Array>> {
  const result = new Map<number, Uint8Array>();

  for (const entry of manifest.keys) {
    const grant = findGrant(manifest, account, entry.epoch, accountPublicKey);
    if (!grant) continue;

    const activityKey = await unwrapActivityKey(
      grant,
      accountPrivateKey,
      manifest.activityId,
      entry.epoch,
    );
    result.set(entry.epoch, activityKey);
  }

  return result;
}

export async function decryptKeyForEpoch(
  manifest: KeyManifest,
  account: Address,
  epoch: number,
  accountPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const grant = findGrant(manifest, account, epoch);
  if (!grant) {
    throw new Error(`当前地址没有第 ${epoch} 代活动密钥授权`);
  }

  return unwrapActivityKey(grant, accountPrivateKey, manifest.activityId, epoch);
}

export function createEmptyManifest(activityId: string, activeEpoch: number): KeyManifest {
  return {
    schemaVersion: 2,
    activityId,
    activeEpoch,
    updatedAt: new Date().toISOString(),
    keys: [],
  };
}

export function upsertGrant(
  manifest: KeyManifest,
  epoch: number,
  grant: KeyGrant,
): KeyManifest {
  const keys = manifest.keys.map((entry) => ({
    ...entry,
    grants: [...entry.grants],
  }));
  let epochEntry = keys.find((entry) => entry.epoch === epoch);

  if (!epochEntry) {
    epochEntry = { epoch, grants: [] };
    keys.push(epochEntry);
  }

  epochEntry.grants = epochEntry.grants.filter(
    (existing) => existing.recipient.toLowerCase() !== grant.recipient.toLowerCase(),
  );
  epochEntry.grants.push(grant);
  keys.sort((left, right) => left.epoch - right.epoch);

  return {
    ...manifest,
    activeEpoch: Math.max(manifest.activeEpoch, epoch),
    updatedAt: new Date().toISOString(),
    keys,
  };
}

export function ensureEpoch(
  manifest: KeyManifest,
  epoch: number,
): KeyEpochEntry {
  const existing = manifest.keys.find((entry) => entry.epoch === epoch);
  if (existing) return existing;

  const entry = { epoch, grants: [] };
  manifest.keys.push(entry);
  manifest.keys.sort((left, right) => left.epoch - right.epoch);
  manifest.activeEpoch = Math.max(manifest.activeEpoch, epoch);
  return entry;
}

export async function grantActivityKey(
  manifest: KeyManifest,
  epoch: number,
  activityKey: Uint8Array,
  recipient: Address,
  recipientPublicKey: Hex,
): Promise<KeyManifest> {
  const grant = await wrapActivityKey(
    activityKey,
    recipientPublicKey,
    recipient,
    manifest.activityId,
    epoch,
  );
  return upsertGrant(manifest, epoch, grant);
}

export async function uploadKeyManifest(manifest: KeyManifest): Promise<{
  txId: Hex;
  manifestHash: Hex;
}> {
  const bytes = utf8(canonicalJson(manifest));
  const manifestHash = await sha256Hex(bytes);
  const receipt = await uploadEncryptedBytes(bytes, "application/json", {
    app: "activity-photo-dapp",
    type: "key-manifest",
    activityId: manifest.activityId,
  });

  return {
    txId: receipt.txId,
    manifestHash,
  };
}

export async function loadAndVerifyKeyManifest(
  activityId: string,
  activity: Pick<ActivityRecord, "keyManifestTxId" | "keyManifestHash">,
): Promise<KeyManifest> {
  if (activity.keyManifestTxId === `0x${"0".repeat(64)}`) {
    throw new Error("活动尚未初始化密钥清单");
  }

  const bytes = await fetchEncryptedBytes(activity.keyManifestTxId);
  const actualHash = await sha256Hex(bytes);
  if (actualHash.toLowerCase() !== activity.keyManifestHash.toLowerCase()) {
    throw new Error("密钥清单哈希校验失败");
  }

  const manifest = parseCanonicalJson<unknown>(new TextDecoder().decode(bytes));
  if (!isKeyManifest(manifest)) {
    throw new Error("密钥清单格式无效");
  }
  return manifest;
}

export function manifestEnvelopeBytesFromHex(value: Hex): Uint8Array {
  return hexToBytes(value);
}

export function manifestHex(value: Uint8Array): Hex {
  return bytesToHex(value);
}
