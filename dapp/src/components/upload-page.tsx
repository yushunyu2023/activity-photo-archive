"use client";

import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bytesToHex, type Hex, type PublicClient } from "viem";
import { useKeyVault } from "@/components/key-vault-provider";
import { useToast } from "@/components/toast-provider";
import { TransactionStatusNotice } from "@/components/transaction-status-notice";
import { useTrackedTransaction } from "@/hooks/use-tracked-transaction";
import {
  ACTIVITY_PHOTO_REGISTRY_ABI,
  REGISTRY_ADDRESS,
  requireRegistryAddress,
} from "@/lib/contract";
import { canonicalJson, utf8 } from "@/lib/canonical-json";
import {
  decryptKeyForEpoch,
  loadAndVerifyKeyManifest,
} from "@/lib/key-manifest";
import { isKeyVaultSessionError } from "@/lib/key-vault-session";
import {
  derivePhotoKey,
  deriveTimeCapsulePhotoKey,
  encryptMetadata,
  encryptPhotoBytes,
  generateTimeCapsuleSecret,
  newNonce,
  sha256Hex,
  wipeBytes,
} from "@/lib/crypto";
import {
  findPhotoByContentHash,
  readActivity,
  readTimeCapsule,
} from "@/lib/activity-queries";
import {
  countCharacters,
  createPreview,
  extractCaptureTime,
  formatBytes,
  readFileBytes,
} from "@/lib/image";
import { toDateTimeLocalValue } from "@/lib/format";
import { uploadEncryptedBytes } from "@/lib/storage";
import {
  QUICKNET,
  createQuicknetClient,
  encryptTimeCapsuleSecret,
  validateUnlockAt,
} from "@/lib/time-capsule";
import {
  TrackedTransactionError,
} from "@/lib/transaction-tracking";
import type { TrackedTransactionOptions } from "@/lib/transaction-tracking";
import {
  decodeContractError,
  describeTransactionError,
} from "@/lib/transaction-errors";
import type {
  EncryptedMetadataEnvelope,
  PhotoMetadata,
  TimeCapsuleRecord,
} from "@/lib/types";
import { TARGET_CHAIN } from "@/lib/wagmi";

type UploadStatus =
  | "ready"
  | "processing"
  | "uploading"
  | "publishing"
  | "done"
  | "error";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  description: string;
  capturedAt: string;
  status: UploadStatus;
  message?: string;
  contentHash?: Hex;
  pendingTransactionHash?: Hex;
  timeCapsuleEnabled: boolean;
  unlockAt: string;
};

function defaultCapsuleUnlockAt(): string {
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  nextHour.setSeconds(0, 0);
  return toDateTimeLocalValue(nextHour);
}

export function UploadPage({ activityId }: { activityId: string }) {
  const id = BigInt(activityId);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const {
    accountEncryption,
    runWithPrivateKey,
    unlocked,
  } = useKeyVault();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const tracked = useTrackedTransaction();
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;

  const activityQuery = useQuery({
    queryKey: ["activity", activityId, REGISTRY_ADDRESS],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        REGISTRY_ADDRESS,
    ),
    queryFn: () => readActivity(publicClient as unknown as PublicClient, id),
  });

  const accessQuery = useQuery({
    queryKey: ["upload-access", activityId, address],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        address &&
        REGISTRY_ADDRESS,
    ),
    queryFn: async () => {
      const client = publicClient as unknown as PublicClient;
      return client.readContract({
        address: requireRegistryAddress(),
        abi: ACTIVITY_PHOTO_REGISTRY_ABI,
        functionName: "canPublish",
        args: [id, address!],
      });
    },
  });

  const manifestReady = Boolean(
    activityQuery.data &&
      activityQuery.data.keyManifestTxId !== `0x${"0".repeat(64)}`,
  );
  const readyToUpload =
    Boolean(address && accountEncryption && unlocked && publicClient) &&
    !wrongNetwork &&
    Boolean(accessQuery.data) &&
    manifestReady &&
    !uploading;
  const isOwner = Boolean(
    address &&
      activityQuery.data &&
      address.toLowerCase() === activityQuery.data.owner.toLowerCase(),
  );

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const prepared = await Promise.all(
      files.map(async (file): Promise<UploadItem | null> => {
        if (!file.type.startsWith("image/")) {
          pushToast({ tone: "error", title: `${file.name} 不是图片文件` });
          return null;
        }
        if (file.size > 25 * 1024 * 1024) {
          pushToast({
            tone: "error",
            title: `${file.name} 超过 25MB`,
            description: "请压缩原图后再上传，或调整开发环境限制。",
          });
          return null;
        }

        const captured = await extractCaptureTime(file);
        return {
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          description: "",
          capturedAt: toDateTimeLocalValue(captured),
          timeCapsuleEnabled: false,
          unlockAt: defaultCapsuleUnlockAt(),
          status: "ready",
        };
      }),
    );

    setItems((current) => [
      ...current,
      ...prepared.filter((item): item is UploadItem => item !== null),
    ]);
  }

  function updateItem(idToUpdate: string, patch: Partial<UploadItem>) {
    setItems((current) =>
      current.map((item) => (item.id === idToUpdate ? { ...item, ...patch } : item)),
    );
  }

  function removeItem(item: UploadItem) {
    if (uploading) return;
    URL.revokeObjectURL(item.previewUrl);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
  }

  function removeCompletedItem(itemId: string) {
    setItems((current) => {
      const completed = current.find((item) => item.id === itemId);
      if (completed) URL.revokeObjectURL(completed.previewUrl);
      return current.filter((item) => item.id !== itemId);
    });
  }

  function rememberPublishedAsset(assetId: Hex) {
    window.sessionStorage.setItem(
      `activity-photo-recent-asset-v2:${activityId}`,
      assetId,
    );
  }

  async function checkPublishedItem(item: UploadItem) {
    if (
      !address ||
      !publicClient ||
      !item.contentHash ||
      !item.pendingTransactionHash
    ) {
      return;
    }
    try {
      const result = await tracked.check({
        publicClient: publicClient as unknown as PublicClient,
        chainId,
        account: address,
        action: "publish-photo",
        resourceId: item.contentHash,
        onStatus: (state) => {
          if (state.status === "checking") {
            updateItem(item.id, {
              status: "publishing",
              message: "正在只读检查链上状态",
            });
          } else if (state.status === "business_verifying") {
            updateItem(item.id, {
              status: "publishing",
              message: "回执已找到，正在确认照片记录",
              pendingTransactionHash: state.transactionHash,
            });
          }
        },
        preflight: async () => ({ satisfied: false }),
        send: async () => {
          throw new Error("检查流程不会发送交易");
        },
        verify: async () => {
          const existing = await findPhotoByContentHash(
            publicClient as unknown as PublicClient,
            id,
            item.contentHash!,
          );
          if (!existing) {
            throw new Error("链上尚未找到这张照片");
          }
          rememberPublishedAsset(existing.assetId);
          return existing;
        },
      } satisfies TrackedTransactionOptions<Awaited<ReturnType<typeof findPhotoByContentHash>>>);
      removeCompletedItem(item.id);
      await queryClient.invalidateQueries({
        queryKey: ["activity-photos", activityId, REGISTRY_ADDRESS],
      });
      pushToast({
        tone: "success",
        title: "照片发布状态已确认",
        description: `${item.file.name} 已从待上传列表移除。`,
      });
      return result;
    } catch (error) {
      const failure = describeTransactionError(
        error,
        ACTIVITY_PHOTO_REGISTRY_ABI,
      );
      updateItem(item.id, {
        status: "error",
        message: failure.description,
        pendingTransactionHash: item.pendingTransactionHash,
        contentHash: item.contentHash,
      });
    }
  }

  async function publishAll() {
    if (
      !readyToUpload ||
      !address ||
      !unlocked ||
      !publicClient ||
      !activityQuery.data
    ) {
      pushToast({
        tone: "info",
        title: "请先在右上角解锁安全密码",
        description: "已选文件会保留在当前页面。",
      });
      return;
    }

    const pendingItems = items.filter(
      (item) => item.status === "ready" || item.status === "error",
    );
    if (!pendingItems.length) {
      pushToast({ tone: "info", title: "没有待发布照片" });
      return;
    }

    const invalid = pendingItems.find((item) => {
      const description = item.description.trim();
      const length = countCharacters(description);
      return (
        length < 1 ||
        length > 50 ||
        /[\u0000-\u001f\u007f]/.test(description)
      );
    });
    if (invalid) {
      pushToast({
        tone: "error",
        title: "描述长度不正确",
        description: "每张照片需要 1 至 50 个字符的描述。",
      });
      return;
    }

    const invalidCapsule = pendingItems.find((item) => {
      if (!item.timeCapsuleEnabled) return false;
      if (!isOwner) return true;
      try {
        const unlockAtMs = new Date(item.unlockAt).getTime();
        if (unlockAtMs % 60_000 !== 0) return true;
        validateUnlockAt(Math.floor(unlockAtMs / 1000));
        return false;
      } catch {
        return true;
      }
    });
    if (invalidCapsule) {
      pushToast({
        tone: "error",
        title: "时间胶囊设置无效",
        description: isOwner
          ? "解锁时间必须按分钟选择、晚于当前时间，且不超过 30 天。"
          : "只有活动所有者可以创建时间胶囊。",
      });
      return;
    }

    setUploading(true);
    const activityKeyHolder: { current: Uint8Array | null } = {
      current: null,
    };
    let publishedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    try {
      await runWithPrivateKey(async (privateKey, assertSessionCurrent) => {
        const manifest = await loadAndVerifyKeyManifest(
          activityId,
          activityQuery.data,
        );
        activityKeyHolder.current = await decryptKeyForEpoch(
          manifest,
          address,
          activityQuery.data.keyEpoch,
          privateKey,
        );

        for (const item of pendingItems) {
          assertSessionCurrent();
          let contentHash: Hex | undefined;
          let transactionHash: Hex | undefined;
          let capsuleSecret: Uint8Array | null = null;
          let unlockAt: bigint | undefined;
          let targetRound: number | undefined;
          let tlockCiphertextTxId: Hex | undefined;
          let tlockCiphertextHash: Hex | undefined;
          try {
            const publishAsTimeCapsule = item.timeCapsuleEnabled;
            updateItem(item.id, { status: "processing", message: "读取原图并生成预览" });
            const originalBytes = await readFileBytes(item.file);
            const currentContentHash = await sha256Hex(originalBytes);
            contentHash = currentContentHash;
            updateItem(item.id, { contentHash: currentContentHash });
            const capturedAtMs = new Date(item.capturedAt).getTime();
            if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) {
              throw new Error("拍摄时间无效");
            }
            if (capturedAtMs > Date.now() + 24 * 60 * 60 * 1000) {
              throw new Error("拍摄时间不能超过当前时间 24 小时");
            }
            const capturedAt = BigInt(Math.floor(capturedAtMs / 1000));

            if (publishAsTimeCapsule) {
              if (!isOwner) throw new Error("只有活动所有者可以创建时间胶囊");
              const unlockAtMs = new Date(item.unlockAt).getTime();
              if (unlockAtMs % 60_000 !== 0) {
                throw new Error("时间胶囊解锁时间必须按分钟选择");
              }
              targetRound = validateUnlockAt(Math.floor(unlockAtMs / 1000));
              unlockAt = BigInt(Math.floor(unlockAtMs / 1000));
            }

            const existingPhoto = await findPhotoByContentHash(
              publicClient as unknown as PublicClient,
              id,
              currentContentHash,
            );
            if (existingPhoto) {
              const message = "该照片已在活动中发布，跳过重复登记";
              updateItem(item.id, {
                status: "done",
                message,
                contentHash: currentContentHash,
              });
              rememberPublishedAsset(existingPhoto.assetId);
              removeCompletedItem(item.id);
              skippedCount += 1;
              pushToast({
                tone: "info",
                title: "照片已经发布",
                description: `${item.file.name}：同一张原图不能重复登记。`,
              });
              continue;
            }

            const preview = await createPreview(item.file);
            const previewHash = await sha256Hex(preview.bytes);
            let tlockCiphertextBytes: Uint8Array | undefined;
            if (publishAsTimeCapsule && targetRound !== undefined) {
              updateItem(item.id, {
                status: "processing",
                message: "正在生成时间锁",
              });
              capsuleSecret = generateTimeCapsuleSecret();
              const armored = await encryptTimeCapsuleSecret(
                capsuleSecret,
                { targetRound },
                createQuicknetClient(),
              );
              tlockCiphertextBytes = utf8(armored);
              tlockCiphertextHash = await sha256Hex(tlockCiphertextBytes);
            }

            const photoKey =
              publishAsTimeCapsule && capsuleSecret && targetRound !== undefined
                ? await deriveTimeCapsulePhotoKey(
                    activityKeyHolder.current,
                    capsuleSecret,
                    activityId,
                    activityQuery.data.keyEpoch,
                    currentContentHash,
                    targetRound,
                  )
                : await derivePhotoKey(
                    activityKeyHolder.current,
                    activityId,
                    activityQuery.data.keyEpoch,
                    currentContentHash,
                  );
            const encryptedOriginal = await encryptPhotoBytes(
              photoKey,
              originalBytes,
              activityId,
              activityQuery.data.keyEpoch,
              currentContentHash,
              "photo",
              publishAsTimeCapsule,
            );
            const encryptedPreview = await encryptPhotoBytes(
              photoKey,
              preview.bytes,
              activityId,
              activityQuery.data.keyEpoch,
              currentContentHash,
              "preview",
              publishAsTimeCapsule,
            );

            assertSessionCurrent();
            updateItem(item.id, {
              status: "uploading",
              message: publishAsTimeCapsule
                ? "上传加密原图、预览和时间锁密文"
                : "上传加密原图和预览",
            });
            const [photoReceipt, previewReceipt, tlockReceipt] = await Promise.all([
              uploadEncryptedBytes(encryptedOriginal.ciphertext, "application/octet-stream", {
                app: "activity-photo-dapp",
                type: "photo",
                activityId,
                keyEpoch: String(activityQuery.data.keyEpoch),
              }),
              uploadEncryptedBytes(encryptedPreview.ciphertext, "application/octet-stream", {
                app: "activity-photo-dapp",
                type: "preview",
                activityId,
                keyEpoch: String(activityQuery.data.keyEpoch),
              }),
              tlockCiphertextBytes
                ? uploadEncryptedBytes(
                    tlockCiphertextBytes,
                    "application/octet-stream",
                    {
                      app: "activity-photo-dapp",
                      type: "time-capsule",
                      activityId,
                      keyEpoch: String(activityQuery.data.keyEpoch),
                    },
                  )
                : Promise.resolve(undefined),
            ]);
            assertSessionCurrent();
            tlockCiphertextTxId = tlockReceipt?.txId;

            const metadata: PhotoMetadata = {
              schemaVersion: 2,
              assetType: "photo",
              activityId,
              capturedAt: new Date(Number(capturedAt) * 1000).toISOString(),
              description: item.description.trim(),
              original: {
                mimeType: item.file.type || "application/octet-stream",
                byteLength: originalBytes.byteLength,
                sha256: currentContentHash,
                txId: photoReceipt.txId,
              },
              preview: {
                mimeType: preview.mimeType,
                byteLength: preview.bytes.byteLength,
                sha256: previewHash,
                txId: previewReceipt.txId,
                width: preview.width,
                height: preview.height,
                maxEdge: preview.maxEdge,
                quality: preview.quality,
              },
              encryption: {
                algorithm: "AES-256-GCM",
                keyEpoch: activityQuery.data.keyEpoch,
                originalNonce: encryptedOriginal.nonce,
                previewNonce: encryptedPreview.nonce,
              },
              ...(publishAsTimeCapsule &&
              unlockAt !== undefined &&
              targetRound !== undefined &&
              tlockCiphertextTxId &&
              tlockCiphertextHash
                ? {
                    timeCapsule: {
                      schemaVersion: 1 as const,
                      unlockAt: new Date(Number(unlockAt) * 1000).toISOString(),
                      targetRound,
                      chainHash: QUICKNET.chainHash,
                      tlockCiphertextTxId,
                      tlockCiphertextHash,
                    },
                  }
                : {}),
            };

            const metadataNonce = newNonce();
            const metadataCiphertext = await encryptMetadata(
              photoKey,
              metadata,
              metadataNonce,
              activityId,
              activityQuery.data.keyEpoch,
              currentContentHash,
              publishAsTimeCapsule,
            );
            const envelope: EncryptedMetadataEnvelope = {
              schemaVersion: 2,
              activityId,
              keyEpoch: activityQuery.data.keyEpoch,
              nonce: metadataNonce,
              ciphertext: bytesToHex(metadataCiphertext),
            };
            const envelopeBytes = utf8(canonicalJson(envelope));
            const metadataHash = await sha256Hex(envelopeBytes);
            const metadataReceipt = await uploadEncryptedBytes(
              envelopeBytes,
              "application/json",
              {
                app: "activity-photo-dapp",
                type: "metadata",
                activityId,
                keyEpoch: String(activityQuery.data.keyEpoch),
              },
            );

            updateItem(item.id, {
              status: "publishing",
              message: "正在检查是否已经发布",
              contentHash,
            });
            const published = await tracked.execute({
              publicClient: publicClient as unknown as PublicClient,
              chainId,
              account: address,
              action: "publish-photo",
              resourceId: currentContentHash,
              context: {
                activityId,
                contentHash: currentContentHash,
                keyEpoch: activityQuery.data.keyEpoch,
                isTimeCapsule: publishAsTimeCapsule,
              },
              onStatus: (state) => {
                if (state.transactionHash) transactionHash = state.transactionHash;
                if (state.status === "awaiting_wallet") {
                  updateItem(item.id, { status: "publishing", message: "等待钱包确认交易" });
                } else if (state.status === "pending") {
                  updateItem(item.id, {
                    status: "publishing",
                    message: "交易已提交，正在监控链上回执",
                    pendingTransactionHash: state.transactionHash,
                  });
                } else if (state.status === "business_verifying") {
                  updateItem(item.id, {
                    status: "publishing",
                    message: "交易已上链，正在确认照片记录",
                    pendingTransactionHash: state.transactionHash,
                  });
                }
              },
              preflight: async () => {
                assertSessionCurrent();
                const existing = await findPhotoByContentHash(
                  publicClient as unknown as PublicClient,
                  id,
                  currentContentHash,
                );
                if (!existing) return { satisfied: false };
                if (existing.photo.isTimeCapsule !== publishAsTimeCapsule) {
                  throw new Error("同一张原图已按另一种照片模式发布，不能重复登记");
                }
                return { satisfied: true, result: existing };
              },
              send: () => {
                assertSessionCurrent();
                if (publishAsTimeCapsule) {
                  if (
                    unlockAt === undefined ||
                    targetRound === undefined ||
                    !tlockCiphertextTxId ||
                    !tlockCiphertextHash
                  ) {
                    throw new Error("时间胶囊链上参数尚未准备完成");
                  }
                  return writeContractAsync({
                    address: requireRegistryAddress(),
                    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                    functionName: "publishTimeCapsule",
                    args: [
                      id,
                      photoReceipt.txId,
                      metadataReceipt.txId,
                      currentContentHash,
                      metadataHash,
                      capturedAt,
                      activityQuery.data.keyEpoch,
                      {
                        unlockAt,
                        targetRound,
                        period: QUICKNET.period,
                        genesisTime: BigInt(QUICKNET.genesisTime),
                        chainHash: QUICKNET.chainHash,
                        publicKey: QUICKNET.publicKey,
                        schemeID: QUICKNET.schemeID,
                        tlockCiphertextTxId,
                        tlockCiphertextHash,
                      },
                    ],
                  });
                }
                return writeContractAsync({
                  address: requireRegistryAddress(),
                  abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                  functionName: "publishPhoto",
                  args: [
                    id,
                    photoReceipt.txId,
                    metadataReceipt.txId,
                    currentContentHash,
                    metadataHash,
                    capturedAt,
                    activityQuery.data.keyEpoch,
                  ],
                });
              },
              verify: async () => {
                const existing = await findPhotoByContentHash(
                  publicClient as unknown as PublicClient,
                  id,
                  currentContentHash,
                );
                if (
                  !existing ||
                  existing.photo.publisher.toLowerCase() !== address.toLowerCase() ||
                  existing.photo.keyEpoch !== activityQuery.data.keyEpoch ||
                  existing.photo.isTimeCapsule !== publishAsTimeCapsule
                ) {
                  throw new Error("交易已上链，但照片业务状态尚未匹配");
                }
                if (publishAsTimeCapsule) {
                  const storedCapsule = await readTimeCapsule(
                    publicClient as unknown as PublicClient,
                    existing.assetId,
                  );
                  if (
                    unlockAt === undefined ||
                    targetRound === undefined ||
                    !tlockCiphertextTxId ||
                    !tlockCiphertextHash ||
                    storedCapsule.unlockAt !== unlockAt ||
                    storedCapsule.targetRound !== targetRound ||
                    storedCapsule.tlockCiphertextTxId.toLowerCase() !==
                      tlockCiphertextTxId.toLowerCase() ||
                    storedCapsule.tlockCiphertextHash.toLowerCase() !==
                      tlockCiphertextHash.toLowerCase()
                  ) {
                    throw new Error("交易已上链，但时间胶囊承诺尚未匹配");
                  }
                }
                rememberPublishedAsset(existing.assetId);
                return existing;
              },
            });
            removeCompletedItem(item.id);
            await queryClient.invalidateQueries({
              queryKey: ["activity-photos", activityId, REGISTRY_ADDRESS],
            });
            if (published) {
              publishedCount += 1;
              pushToast({
                tone: "success",
                title: `${item.file.name} 已发布`,
                description: "已从待上传列表移除并释放本地预览。",
              });
            }
          } catch (error) {
            if (isKeyVaultSessionError(error)) throw error;
            failedCount += 1;
            const failure = describeTransactionError(
              error,
              ACTIVITY_PHOTO_REGISTRY_ABI,
            );
            updateItem(item.id, {
              status: "error",
              message: failure.description,
              contentHash,
              pendingTransactionHash:
                error instanceof TrackedTransactionError
                  ? error.transactionHash ?? transactionHash
                  : item.pendingTransactionHash,
            });
            pushToast({
              tone: "error",
              title: `${item.file.name}：${failure.title}`,
              description: failure.description,
            });
            const refreshed = await activityQuery.refetch();
            if (
              refreshed.data &&
              refreshed.data.keyEpoch !== activityQuery.data.keyEpoch
            ) {
              pushToast({
                tone: "info",
                title: "活动密钥已轮换",
                description: "请重新点击发布，剩余照片会使用最新密钥加密。",
              });
              break;
            }
          } finally {
            wipeBytes(capsuleSecret);
          }
        }

        if (publishedCount > 0 || failedCount > 0) {
          const details = [
            publishedCount > 0 ? `${publishedCount} 张已发布` : null,
            skippedCount > 0 ? `${skippedCount} 张重复跳过` : null,
            failedCount > 0 ? `${failedCount} 张失败可重试` : null,
          ].filter(Boolean);
          pushToast({
            tone: failedCount > 0 ? "info" : "success",
            title: failedCount > 0 ? "上传流程部分完成" : "上传流程结束",
            description: `${details.join("，")}。`,
          });
        }
      });
    } catch (error) {
      pushToast({
        tone: "error",
        title: isKeyVaultSessionError(error) ? "上传已停止" : "无法开始上传",
        description: error instanceof Error ? error.message : "请检查安全密码授权",
      });
    } finally {
      activityKeyHolder.current?.fill(0);
      activityKeyHolder.current = null;
      setUploading(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="setup-panel">
        <p className="eyebrow">WALLET REQUIRED</p>
        <h2>连接钱包后上传</h2>
        <p>照片登记必须由有上传权限的钱包签名。</p>
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <h2>请切换到 {TARGET_CHAIN.name}</h2>
        <p>切换网络后才能确认活动上传权限。</p>
      </div>
    );
  }

  if (activityQuery.isLoading || accessQuery.isLoading) {
    return (
      <div className="loading-panel">
        <LoaderCircle className="spin" size={22} />
        正在读取活动
      </div>
    );
  }

  if (!activityQuery.data) {
    const decoded = decodeContractError(
      activityQuery.error,
      ACTIVITY_PHOTO_REGISTRY_ABI,
    );
    const notFound = decoded?.errorName === "ActivityNotFound";
    return (
      <div className="setup-panel setup-panel-error">
        <h2>{notFound ? "活动不存在或本地链已重置" : "暂时无法读取活动"}</h2>
        <p>
          {notFound
            ? `链上未找到活动 #${activityId}。`
            : "请检查钱包网络后重试。"}
        </p>
        <Link className="button button-secondary" href="/">
          <ArrowLeft size={16} />
          返回活动列表
        </Link>
      </div>
    );
  }

  if (accessQuery.isError) {
    return (
      <div className="setup-panel setup-panel-error">
        <h2>暂时无法确认上传权限</h2>
        <p>请检查钱包网络后重试。</p>
        <div className="page-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => accessQuery.refetch()}
          >
            重试
          </button>
          <Link className="button button-secondary" href="/">
            <ArrowLeft size={16} />
            返回活动列表
          </Link>
        </div>
      </div>
    );
  }

  if (!accessQuery.data) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <p className="eyebrow">UPLOAD ACCESS DENIED</p>
        <h2>当前钱包没有上传权限</h2>
        <p>上传入口不会展示活动名称、时间线或照片索引。</p>
        <Link className="button button-secondary" href="/">
          <ArrowLeft size={16} />
          返回活动列表
        </Link>
      </div>
    );
  }

  const capsuleMinimum = toDateTimeLocalValue(
    new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000),
  );
  const capsuleMaximum = toDateTimeLocalValue(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  );

  return (
    <div className="upload-layout">
      <div className="upload-main">
        <Link className="back-link" href={`/activities/${activityId}`}>
          <ArrowLeft size={15} />
          返回 {activityQuery.data.name}
        </Link>
        <div className="page-heading upload-heading">
          <div>
            <p className="eyebrow">PUBLISH PHOTOS</p>
            <h1>上传到 {activityQuery.data.name}</h1>
            <p>原图保持原始字节，WebP/JPEG 预览仅用于时间线展示。</p>
          </div>
          <span className="badge badge-green">
            <KeyRound size={12} />
            密钥代际 {activityQuery.data.keyEpoch}
          </span>
        </div>

        {!manifestReady ? (
          <div className="callout callout-warning">
            <KeyRound size={18} />
            <p>活动密钥清单尚未初始化，请返回活动页由所有者完成初始化。</p>
          </div>
        ) : !unlocked ? (
          <div className="callout callout-warning">
            <LockKeyhole size={18} />
            <p>请先在右上角解锁安全密码。已选照片和描述会保留。</p>
          </div>
        ) : null}

        <TransactionStatusNotice
          state={tracked.state}
          onCheck={() => void tracked.check()}
        />

        <label className="dropzone">
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={uploading}
            onChange={addFiles}
          />
          <ImagePlus size={29} />
          <strong>选择活动照片</strong>
          <span>可一次选择多张；单张不超过 25MB</span>
        </label>

        <div className="upload-items">
          {items.map((item, index) => (
            <article className="upload-item" key={item.id}>
              <div className="upload-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt="" />
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="upload-fields">
                <div className="upload-file-line">
                  <div>
                    <strong>{item.file.name}</strong>
                    <span>
                      {formatBytes(item.file.size)} · {item.file.type || "未知格式"}
                    </span>
                  </div>
                  <button
                    className="icon-button icon-button-small"
                    type="button"
                    aria-label="移除照片"
                    disabled={uploading}
                    onClick={() => removeItem(item)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="upload-field-grid">
                  <label className="field">
                    <span>
                      一句话描述
                      <small className={countCharacters(item.description) > 50 ? "field-count-error" : ""}>
                        {countCharacters(item.description)}/50
                      </small>
                    </span>
                    <input
                      type="text"
                      value={item.description}
                      disabled={uploading || item.status === "done"}
                      maxLength={80}
                      placeholder="例如：第一次全家去海边"
                      onChange={(event) =>
                        updateItem(item.id, { description: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>拍摄时间</span>
                    <input
                      type="datetime-local"
                      value={item.capturedAt}
                      disabled={uploading || item.status === "done"}
                      onChange={(event) =>
                        updateItem(item.id, { capturedAt: event.target.value })
                      }
                    />
                  </label>
                </div>
                {isOwner ? (
                  <div className="time-capsule-editor">
                    <label className="time-capsule-toggle">
                      <input
                        type="checkbox"
                        checked={item.timeCapsuleEnabled}
                        disabled={uploading || item.status === "done"}
                        onChange={(event) => {
                          const enabled = event.target.checked;
                          updateItem(item.id, {
                            timeCapsuleEnabled: enabled,
                            unlockAt:
                              enabled &&
                              new Date(item.unlockAt).getTime() <= Date.now()
                                ? defaultCapsuleUnlockAt()
                                : item.unlockAt,
                          });
                        }}
                      />
                      <span>
                        <Clock3 size={15} />
                        设为时间胶囊
                      </span>
                    </label>
                    {item.timeCapsuleEnabled ? (
                      <div className="time-capsule-fields">
                        <label className="field">
                          <span>解锁时间（本地时区）</span>
                          <input
                            type="datetime-local"
                            aria-label="时间胶囊解锁时间"
                            value={item.unlockAt}
                            min={capsuleMinimum}
                            max={capsuleMaximum}
                            step={60}
                            disabled={uploading || item.status === "done"}
                            onChange={(event) =>
                              updateItem(item.id, {
                                unlockAt: event.target.value,
                              })
                            }
                          />
                        </label>
                        <p>
                          解锁不会早于设定时间；正常网络下可能晚约数秒，Drand
                          或网络异常时可能延迟更久。发布后不可修改。
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className={`upload-status upload-status-${item.status}`}>
                  {item.status === "done" ? (
                    <CheckCircle2 size={15} />
                  ) : item.status === "error" ? (
                    <CircleAlert size={15} />
                  ) : item.status === "ready" ? (
                    <Camera size={15} />
                  ) : (
                    <LoaderCircle className="spin" size={15} />
                  )}
                  <span>
                    {item.message ??
                      (item.status === "ready"
                        ? "等待发布"
                        : item.status === "done"
                          ? "已发布"
                          : "处理中")}
                  </span>
                </div>
                {item.status === "error" &&
                item.pendingTransactionHash &&
                item.contentHash ? (
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    onClick={() => void checkPublishedItem(item)}
                  >
                    <LoaderCircle size={14} />
                    重新检查链上状态
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="upload-aside">
        <div className="upload-summary">
          <p className="eyebrow">UPLOAD PLAN</p>
          <strong>{items.length}</strong>
          <span>张照片</span>
          <div className="summary-rule" />
          <p>
            原始总大小{" "}
            {formatBytes(items.reduce((sum, item) => sum + item.file.size, 0))}
          </p>
          <p>每张照片需要一笔 Base 登记交易。</p>
        </div>
        <button
          className="button button-primary button-large upload-submit"
          type="button"
          disabled={!readyToUpload || items.length === 0}
          onClick={publishAll}
        >
          {uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}
          {uploading ? "正在发布" : "加密并发布"}
        </button>
        <div className="callout callout-neutral upload-note">
          <LockKeyhole size={18} />
          <p>
            加密在本设备完成。上传服务只接收密文，Base 交易会记录照片和元数据哈希。
          </p>
        </div>
        <Link className="button button-ghost" href={`/activities/${activityId}`}>
          返回时间线
        </Link>
      </aside>
    </div>
  );
}
