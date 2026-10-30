"use client";

import {
  ArrowLeft,
  CalendarDays,
  Download,
  ExternalLink,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { PublicClient } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
} from "wagmi";
import { useKeyVault } from "@/components/key-vault-provider";
import { useToast } from "@/components/toast-provider";
import {
  ACTIVITY_PHOTO_REGISTRY_ABI,
  REGISTRY_ADDRESS,
  requireRegistryAddress,
} from "@/lib/contract";
import {
  readActivity,
  readPhoto,
} from "@/lib/activity-queries";
import {
  formatUnixDate,
  shortAddress,
  shortHash,
} from "@/lib/format";
import {
  decodeContractError,
} from "@/lib/transaction-errors";
import {
  decryptPhotoPreview,
  decryptPhotoOriginal,
} from "@/lib/photo-access";
import { TARGET_CHAIN } from "@/lib/wagmi";

export function AssetPage({ assetId }: { assetId: `0x${string}` }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const {
    runWithPrivateKey,
    sessionGeneration,
    unlocked,
  } = useKeyVault();
  const { pushToast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;

  const detailQuery = useQuery({
    queryKey: ["asset-detail", assetId, address, REGISTRY_ADDRESS],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        REGISTRY_ADDRESS,
    ),
    queryFn: async () => {
      const client = publicClient as unknown as PublicClient;
      const photo = await readPhoto(client, assetId);
      const activity = await readActivity(client, photo.activityId);
      const canView = address
        ? Boolean(
            await client.readContract({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName: "canView",
              args: [photo.activityId, address],
            }),
          )
        : false;
      return { photo, activity, canView };
    },
  });

  const previewQuery = useQuery({
    queryKey: [
      "asset-preview",
      assetId,
      address,
      sessionGeneration,
    ],
    enabled: Boolean(
      unlocked &&
        address &&
        detailQuery.data?.canView &&
        detailQuery.data.photo &&
        detailQuery.data.activity,
    ),
    gcTime: 0,
    queryFn: async () => {
      const { photo, activity } = detailQuery.data!;
      const result = await runWithPrivateKey((privateKey) =>
        decryptPhotoPreview(
          photo.activityId.toString(),
          activity,
          photo,
          address!,
          privateKey,
        ),
      );
      const previewUrl = URL.createObjectURL(
        new Blob([result.previewBytes as BlobPart], {
          type: result.metadata.preview.mimeType,
        }),
      );
      return {
        metadata: result.metadata,
        previewUrl,
      };
    },
  });

  useEffect(() => {
    return () => {
      if (previewQuery.data?.previewUrl) URL.revokeObjectURL(previewQuery.data.previewUrl);
    };
  }, [previewQuery.data?.previewUrl]);

  async function downloadOriginal() {
    if (
      !unlocked ||
      !address ||
      !detailQuery.data ||
      !previewQuery.data
    ) {
      pushToast({
        tone: "info",
        title: "请先在右上角解锁安全密码",
      });
      return;
    }
    setDownloading(true);
    try {
      const original = await runWithPrivateKey((privateKey) =>
        decryptPhotoOriginal(
          detailQuery.data.photo.activityId.toString(),
          detailQuery.data.activity,
          detailQuery.data.photo,
          previewQuery.data.metadata,
          address,
          privateKey,
        ),
      );
      const url = URL.createObjectURL(
        new Blob([original.bytes as BlobPart], { type: original.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = original.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast({ tone: "success", title: "原图哈希校验通过并开始下载" });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "原图下载失败",
        description: error instanceof Error ? error.message : "请重试",
      });
    } finally {
      setDownloading(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <h2>连接钱包查看照片</h2>
        <p>照片详情仅向拥有对应活动查看权限的钱包展示。</p>
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <div className="setup-panel">
        <ShieldCheck size={28} />
        <h2>请切换到 {TARGET_CHAIN.name}</h2>
        <p>切换网络后才能校验照片权限和哈希。</p>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="loading-panel">
        <LoaderCircle className="spin" size={22} />
        正在读取照片记录
      </div>
    );
  }

  if (!detailQuery.data) {
    const decoded = decodeContractError(
      detailQuery.error,
      ACTIVITY_PHOTO_REGISTRY_ABI,
    );
    const notFound =
      decoded?.errorName === "InvalidStorageReference" ||
      decoded?.errorName === "ActivityNotFound";
    return (
      <div className="setup-panel setup-panel-error">
        <p className="eyebrow">
          {notFound ? "ASSET NOT FOUND" : "READ ERROR"}
        </p>
        <h2>
          {notFound ? "照片不存在或本地链已重置" : "暂时无法读取照片"}
        </h2>
        <p>
          {notFound
            ? "这条照片索引不在当前链上。"
            : "请检查钱包网络后重试。"}
        </p>
        <div className="page-actions">
          {!notFound ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => detailQuery.refetch()}
            >
              重试
            </button>
          ) : null}
          <Link className="button button-secondary" href="/">
            <ArrowLeft size={16} />
            返回活动列表
          </Link>
        </div>
      </div>
    );
  }

  const { photo, activity, canView } = detailQuery.data;
  if (!canView) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <p className="eyebrow">ACCESS DENIED</p>
        <h2>当前钱包没有照片查看权限</h2>
        <p>照片详情不会展示活动、拍摄时间或链上索引。</p>
        <Link className="button button-secondary" href="/">
          <ArrowLeft size={16} />
          返回活动列表
        </Link>
      </div>
    );
  }
  const explorer = TARGET_CHAIN.blockExplorers?.default.url;

  return (
    <div>
      <Link className="back-link" href={`/activities/${photo.activityId.toString()}`}>
        <ArrowLeft size={15} />
        返回活动 #{photo.activityId.toString()}
      </Link>

      <div className="asset-layout">
        <div className="asset-media">
          {!unlocked ? (
            <div className="asset-locked">
              <LockKeyhole size={28} />
              <h2>照片已加密</h2>
              <p>请先在右上角解锁安全密码，DApp 会验证链上哈希并解密预览。</p>
            </div>
          ) : !canView ? (
            <div className="asset-locked">
              <LockKeyhole size={28} />
              <h2>没有查看权限</h2>
              <p>当前钱包不是此活动的授权查看者。</p>
            </div>
          ) : previewQuery.isLoading ? (
            <div className="asset-locked">
              <LoaderCircle className="spin" size={24} />
              <p>正在校验并解密预览</p>
            </div>
          ) : previewQuery.isError ? (
            <div className="asset-locked asset-locked-error">
              <KeyRound size={26} />
              <h2>密钥授权不可用</h2>
              <p>
                {previewQuery.error instanceof Error
                  ? previewQuery.error.message || "照片解密失败，请重试"
                  : "照片解密失败，请重试"}
              </p>
            </div>
          ) : previewQuery.data ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="asset-image-reveal"
              src={previewQuery.data.previewUrl}
              alt={previewQuery.data.metadata.description}
            />
          ) : null}
        </div>

        <div className="asset-info">
          <p className="eyebrow">IMMUTABLE PHOTO RECORD</p>
          <h1>{previewQuery.data?.metadata.description ?? "加密活动照片"}</h1>
          <div className="asset-meta">
            <span>
              <CalendarDays size={14} />
              拍摄 {formatUnixDate(photo.capturedAt)}
            </span>
            <span>
              <ShieldCheck size={14} />
              发布 {formatUnixDate(photo.publishedAt)}
            </span>
            <span>
              <KeyRound size={14} />
              密钥代际 {photo.keyEpoch}
            </span>
          </div>

          <div className="asset-actions">
            <button
              className="button button-primary"
              type="button"
              disabled={
                downloading ||
                !previewQuery.data ||
                !unlocked ||
                !canView
              }
              onClick={downloadOriginal}
            >
              {downloading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Download size={16} />
              )}
              校验并下载原图
            </button>
            {explorer ? (
              <a
                className="button button-secondary"
                href={`${explorer}/address/${REGISTRY_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={15} />
                查看合约
              </a>
            ) : null}
          </div>

          <dl className="asset-ledger">
            <div>
              <dt>活动</dt>
              <dd>#{photo.activityId.toString()}</dd>
            </div>
            <div>
              <dt>上传者</dt>
              <dd>{shortAddress(photo.publisher)}</dd>
            </div>
            <div>
              <dt>内容哈希</dt>
              <dd>
                <Fingerprint size={13} />
                {shortHash(photo.contentHash)}
              </dd>
            </div>
            <div>
              <dt>元数据哈希</dt>
              <dd>{shortHash(photo.metadataHash)}</dd>
            </div>
            <div>
              <dt>照片对象</dt>
              <dd>{shortHash(photo.photoTxId)}</dd>
            </div>
            <div>
              <dt>元数据对象</dt>
              <dd>{shortHash(photo.metadataTxId)}</dd>
            </div>
            <div>
              <dt>活动所有者</dt>
              <dd>{shortAddress(activity.owner)}</dd>
            </div>
          </dl>

          <p className="asset-footnote">
            此记录只有一次发布，没有编辑或删除入口。DApp 在展示和下载前会重新计算照片哈希。
          </p>
          {wrongNetwork ? (
            <div className="callout callout-warning">
              <LockKeyhole size={18} />
              <p>当前钱包不在 {TARGET_CHAIN.name}，链上校验可能不可用。</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
