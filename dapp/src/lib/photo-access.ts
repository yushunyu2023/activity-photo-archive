import type { Address, Hex } from "viem";
import {
  decryptMetadata,
  decryptPhotoBytes,
  derivePhotoKey,
  deriveTimeCapsulePhotoKey,
  sha256Hex,
  wipeBytes,
} from "@/lib/crypto";
import {
  decryptKeyForEpoch,
  loadAndVerifyKeyManifest,
} from "@/lib/key-manifest";
import { fetchEncryptedBytes } from "@/lib/storage";
import {
  decryptTimeCapsuleSecret,
  isTimeCapsuleUnlocked,
  validateStoredTimeCapsule,
} from "@/lib/time-capsule";
import type {
  EncryptedMetadataEnvelope,
  ActivityRecord,
  PhotoMetadata,
  PhotoRecord,
  TimeCapsuleRecord,
} from "@/lib/types";

export type DecryptedPhotoPreview = {
  metadata: PhotoMetadata;
  previewBytes: Uint8Array;
};

export type DecryptedPhotoOriginal = {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
};

function asHex(value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("元数据包含无效的存储引用");
  }
  return value as Hex;
}

function validateMetadata(
  metadata: PhotoMetadata,
  activityId: string,
  photo: PhotoRecord,
  capsule?: TimeCapsuleRecord,
) {
  const capturedAt = Date.parse(metadata.capturedAt);
  const descriptionLength = Array.from(metadata.description).length;
  const previewTypes = new Set(["image/webp", "image/jpeg"]);

  if (
    metadata.schemaVersion !== 2 ||
    metadata.assetType !== "photo" ||
    metadata.activityId !== activityId ||
    metadata.encryption.algorithm !== "AES-256-GCM" ||
    metadata.encryption.keyEpoch !== photo.keyEpoch ||
    !Number.isFinite(capturedAt) ||
    Math.floor(capturedAt / 1000) !== Number(photo.capturedAt) ||
    descriptionLength < 1 ||
    descriptionLength > 50 ||
    /[\u0000-\u001f\u007f]/.test(metadata.description) ||
    !previewTypes.has(metadata.preview.mimeType) ||
    metadata.preview.width < 1 ||
    metadata.preview.height < 1 ||
    (photo.isTimeCapsule &&
      (!metadata.timeCapsule ||
        metadata.timeCapsule.schemaVersion !== 1 ||
        Date.parse(metadata.timeCapsule.unlockAt) !== Number(capsule?.unlockAt ?? 0n) * 1000 ||
        metadata.timeCapsule.targetRound !== capsule?.targetRound ||
        metadata.timeCapsule.chainHash.toLowerCase() !== capsule?.chainHash.toLowerCase() ||
        metadata.timeCapsule.tlockCiphertextTxId.toLowerCase() !==
          capsule?.tlockCiphertextTxId.toLowerCase() ||
        metadata.timeCapsule.tlockCiphertextHash.toLowerCase() !==
          capsule?.tlockCiphertextHash.toLowerCase())) ||
    (!photo.isTimeCapsule && metadata.timeCapsule !== undefined)
  ) {
    throw new Error("解密后的照片元数据不符合协议");
  }
}

async function deriveAccessiblePhotoKey(
  activityId: string,
  activity: ActivityRecord,
  photo: PhotoRecord,
  capsule: TimeCapsuleRecord | undefined,
  account: Address,
  accountPrivateKey: Uint8Array,
): Promise<CryptoKey> {
  if (photo.isTimeCapsule && !capsule) {
    throw new Error("时间胶囊照片缺少链上时间锁记录");
  }

  const manifest = await loadAndVerifyKeyManifest(activityId, activity);
  const activityKey = await decryptKeyForEpoch(
    manifest,
    account,
    photo.keyEpoch,
    accountPrivateKey,
  );

  try {
    if (!photo.isTimeCapsule) {
      return await derivePhotoKey(
        activityKey,
        activityId,
        photo.keyEpoch,
        photo.contentHash,
      );
    }

    validateStoredTimeCapsule(capsule!);
    if (!isTimeCapsuleUnlocked(capsule!)) {
      throw new Error("时间胶囊尚未解锁");
    }

    const capsuleSecret = await decryptTimeCapsuleSecret(capsule!);
    try {
      return await deriveTimeCapsulePhotoKey(
        activityKey,
        capsuleSecret,
        activityId,
        photo.keyEpoch,
        photo.contentHash,
        capsule!.targetRound,
      );
    } finally {
      wipeBytes(capsuleSecret);
    }
  } finally {
    activityKey.fill(0);
  }
}

export async function decryptPhotoPreview(
  activityId: string,
  activity: ActivityRecord,
  photo: PhotoRecord,
  capsule: TimeCapsuleRecord | undefined,
  account: Address,
  accountPrivateKey: Uint8Array,
): Promise<DecryptedPhotoPreview> {
  const photoKey = await deriveAccessiblePhotoKey(
    activityId,
    activity,
    photo,
    capsule,
    account,
    accountPrivateKey,
  );
  {
    const metadataEnvelopeBytes = await fetchEncryptedBytes(photo.metadataTxId);
    const metadataEnvelopeHash = await sha256Hex(metadataEnvelopeBytes);
    if (metadataEnvelopeHash.toLowerCase() !== photo.metadataHash.toLowerCase()) {
      throw new Error("元数据哈希与链上记录不一致");
    }

    const envelope = JSON.parse(
      new TextDecoder().decode(metadataEnvelopeBytes),
    ) as EncryptedMetadataEnvelope;
    if (
      envelope.schemaVersion !== 2 ||
      envelope.activityId !== activityId ||
      envelope.keyEpoch !== photo.keyEpoch
    ) {
      throw new Error("元数据密钥代际不匹配");
    }

    const metadata = await decryptMetadata(
      photoKey,
      envelope,
      photo.contentHash,
      photo.isTimeCapsule,
    );
    validateMetadata(metadata, activityId, photo, capsule);
    if (metadata.original.sha256.toLowerCase() !== photo.contentHash.toLowerCase()) {
      throw new Error("元数据中的照片哈希不匹配");
    }

    const encryptedPreview = await fetchEncryptedBytes(asHex(metadata.preview.txId));
    const previewBytes = await decryptPhotoBytes(
      photoKey,
      encryptedPreview,
      metadata.encryption.previewNonce,
      activityId,
      photo.keyEpoch,
      photo.contentHash,
      "preview",
      photo.isTimeCapsule,
    );
    const previewHash = await sha256Hex(previewBytes);
    if (
      previewHash.toLowerCase() !== metadata.preview.sha256.toLowerCase() ||
      previewBytes.byteLength !== metadata.preview.byteLength
    ) {
      throw new Error("预览图哈希校验失败");
    }

    return {
      metadata,
      previewBytes,
    };
  }
}

export async function decryptPhotoOriginal(
  activityId: string,
  activity: ActivityRecord,
  photo: PhotoRecord,
  capsule: TimeCapsuleRecord | undefined,
  metadata: PhotoMetadata,
  account: Address,
  accountPrivateKey: Uint8Array,
): Promise<DecryptedPhotoOriginal> {
  const photoKey = await deriveAccessiblePhotoKey(
    activityId,
    activity,
    photo,
    capsule,
    account,
    accountPrivateKey,
  );
  {
    const encryptedOriginal = await fetchEncryptedBytes(photo.photoTxId);
    const originalBytes = await decryptPhotoBytes(
      photoKey,
      encryptedOriginal,
      metadata.encryption.originalNonce,
      activityId,
      photo.keyEpoch,
      photo.contentHash,
      "photo",
      photo.isTimeCapsule,
    );
    const originalHash = await sha256Hex(originalBytes);
    if (
      originalHash.toLowerCase() !== photo.contentHash.toLowerCase() ||
      originalBytes.byteLength !== metadata.original.byteLength
    ) {
      throw new Error("原图哈希校验失败");
    }

    const extension =
      metadata.original.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    return {
      bytes: originalBytes,
      mimeType: metadata.original.mimeType,
      fileName: `activity-photo-${photo.contentHash.slice(2, 10)}.${extension}`,
    };
  }
}
