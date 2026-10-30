"use client";

import {
  ArrowLeft,
  Camera,
  CircleAlert,
  Clock3,
  Eye,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { Address, PublicClient } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { useKeyVault } from "@/components/key-vault-provider";
import { useToast } from "@/components/toast-provider";
import { TransactionStatusNotice } from "@/components/transaction-status-notice";
import { useTrackedTransaction } from "@/hooks/use-tracked-transaction";
import {
  ACTIVITY_PHOTO_REGISTRY_ABI,
  REGISTRY_ADDRESS,
  requireRegistryAddress,
} from "@/lib/contract";
import {
  generateActivityKey,
} from "@/lib/crypto";
import {
  listActivityPhotos,
  readActivity,
} from "@/lib/activity-queries";
import { formatUnixDate, shortAddress } from "@/lib/format";
import {
  createEmptyManifest,
  findGrant,
  grantActivityKey,
  isKeyManifest,
  loadAndVerifyKeyManifest,
  uploadKeyManifest,
} from "@/lib/key-manifest";
import { decryptPhotoPreview } from "@/lib/photo-access";
import {
  isTimeCapsuleUnlocked,
  verifyTimeCapsuleBeacon,
} from "@/lib/time-capsule";
import {
  decodeContractError,
  describeTransactionError,
} from "@/lib/transaction-errors";
import type {
  ActivityRecord,
  KeyManifest,
  PhotoRecord,
  TimeCapsuleRecord,
} from "@/lib/types";
import { TARGET_CHAIN } from "@/lib/wagmi";

type ActivityPageProps = {
  activityId: string;
};

function PhotoCard({
  assetId,
  photo,
  capsule,
  activity,
  activityId,
  account,
  index,
  highlighted,
}: {
  assetId: `0x${string}`;
  photo: PhotoRecord;
  capsule?: TimeCapsuleRecord;
  activity: ActivityRecord;
  activityId: string;
  account: Address;
  index: number;
  highlighted: boolean;
}) {
  const {
    runWithPrivateKey,
    publicKey,
    sessionGeneration,
    unlocked,
  } = useKeyVault();
  const cardRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [viewRequested, setViewRequested] = useState(false);

  useEffect(() => {
    if (!capsule || !unlocked) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [capsule, unlocked]);

  const capsuleAccessQuery = useQuery({
    queryKey: [
      "time-capsule-access",
      assetId,
      account,
      publicKey,
      photo.keyEpoch,
    ],
    enabled: Boolean(capsule && unlocked && publicKey),
    queryFn: async () => {
      const manifest = await loadAndVerifyKeyManifest(activityId, activity);
      return Boolean(findGrant(manifest, account, photo.keyEpoch, publicKey!));
    },
  });

  const capsuleUnlocked = Boolean(
    capsule && isTimeCapsuleUnlocked(capsule, now),
  );
  const capsuleReadyQuery = useQuery({
    queryKey: [
      "time-capsule-beacon",
      assetId,
      capsule?.targetRound,
      capsuleUnlocked,
    ],
    enabled: Boolean(
      capsule &&
        unlocked &&
        capsuleAccessQuery.data &&
        capsuleUnlocked,
    ),
    retry: false,
    refetchInterval: (query) =>
      query.state.status === "error" ? 10_000 : false,
    queryFn: () => verifyTimeCapsuleBeacon(capsule!),
  });

  const previewQuery = useQuery({
    queryKey: ["photo-preview", assetId, account, sessionGeneration],
    enabled: Boolean(
      unlocked &&
        (!photo.isTimeCapsule ||
          (viewRequested && capsuleReadyQuery.data === capsule?.targetRound)),
    ),
    gcTime: 0,
    queryFn: async () => {
      const result = await runWithPrivateKey((privateKey) =>
        decryptPhotoPreview(
          activityId,
          activity,
          photo,
          capsule,
          account,
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
    const element = cardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setImageLoaded(false);
  }, [previewQuery.data?.previewUrl]);

  useEffect(() => {
    return () => {
      if (previewQuery.data?.previewUrl) URL.revokeObjectURL(previewQuery.data.previewUrl);
    };
  }, [previewQuery.data?.previewUrl]);

  const countdown = capsule
    ? Math.max(
        0,
        Number(capsule.unlockAt) * 1000 - now,
      )
    : 0;
  const countdownText = (() => {
    const totalMinutes = Math.ceil(countdown / 60_000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    return days > 0
      ? `${days} 天 ${hours} 小时`
      : hours > 0
        ? `${hours} 小时 ${minutes} 分`
        : `${Math.max(1, minutes)} 分`;
  })();

  let frameContent: ReactNode;
  if (!unlocked) {
    frameContent = (
      <div className="photo-locked photo-state-fade">
        <LockKeyhole size={21} />
        <span>请先在右上角解锁安全密码</span>
      </div>
    );
  } else if (capsule && capsuleAccessQuery.isLoading) {
    frameContent = (
      <div className="photo-locked photo-skeleton">
        <LoaderCircle className="spin" size={21} />
        <span>正在核对胶囊代际权限</span>
      </div>
    );
  } else if (capsule && capsuleAccessQuery.data === false) {
    frameContent = (
      <div className="photo-locked photo-locked-error photo-state-fade">
        <KeyRound size={21} />
        <span>当前钱包没有第 {photo.keyEpoch} 代查看权限</span>
      </div>
    );
  } else if (capsule && !capsuleUnlocked) {
    frameContent = (
      <div className="photo-locked time-capsule-locked photo-state-fade">
        <Clock3 size={23} />
        <strong>时间胶囊锁定中</strong>
        <span>约 {countdownText} 后检查时间证明</span>
      </div>
    );
  } else if (capsule && capsuleReadyQuery.isLoading) {
    frameContent = (
      <div className="photo-locked photo-skeleton">
        <LoaderCircle className="spin" size={21} />
        <span>正在验证目标时间证明</span>
      </div>
    );
  } else if (capsule && capsuleReadyQuery.isError) {
    frameContent = (
      <div className="photo-locked photo-locked-error photo-state-fade">
        <Clock3 size={21} />
        <strong>正在等待时间证明</strong>
        <span>Drand 或网络异常时可能延迟更久</span>
        <button type="button" onClick={() => void capsuleReadyQuery.refetch()}>
          重新检查
        </button>
      </div>
    );
  } else if (capsule && !viewRequested) {
    frameContent = (
      <div className="photo-locked time-capsule-ready photo-state-fade">
        <Eye size={23} />
        <strong>时间证明已验证</strong>
        <span>点击后才解密并加载预览</span>
        <button type="button" onClick={() => setViewRequested(true)}>
          查看照片
        </button>
      </div>
    );
  } else if (previewQuery.isLoading) {
    frameContent = (
      <div className="photo-locked photo-skeleton">
        <LoaderCircle className="spin" size={21} />
        <span>正在解密预览</span>
      </div>
    );
  } else if (previewQuery.isError) {
    frameContent = (
      <div className="photo-locked photo-locked-error photo-state-fade">
        <KeyRound size={21} />
        <span>
          {previewQuery.error instanceof Error
            ? previewQuery.error.message || "照片解密失败"
            : "照片解密失败"}
        </span>
      </div>
    );
  } else if (previewQuery.data) {
    frameContent = (
      <Link href={`/asset/${assetId}`} aria-label="查看照片详情">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={imageLoaded ? "photo-image-loaded" : ""}
          src={previewQuery.data.previewUrl}
          alt={previewQuery.data.metadata.description}
          onLoad={() => setImageLoaded(true)}
        />
      </Link>
    );
  } else {
    frameContent = null;
  }

  return (
    <article
      ref={cardRef}
      className={[
        "photo-card",
        "photo-card-reveal",
        visible ? "is-visible" : "",
        highlighted ? "photo-card-highlighted" : "",
      ].filter(Boolean).join(" ")}
      style={{ "--reveal-delay": `${Math.min(index, 12) * 35}ms` } as CSSProperties}
    >
      <div className="photo-frame">{frameContent}</div>
      <div className="photo-card-copy">
        <div className="photo-date">{formatUnixDate(photo.capturedAt)}</div>
        <h3>
          {previewQuery.data?.metadata.description ??
            (photo.isTimeCapsule ? "时间胶囊照片" : "加密照片")}
        </h3>
        <p>
          上传者 {shortAddress(photo.publisher)} · 密钥代际 {photo.keyEpoch}
        </p>
        {capsule ? (
          <span className="time-capsule-badge">
            <Clock3 size={11} />
            时间胶囊 · {formatUnixDate(capsule.unlockAt)}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function ActivityPage({ activityId }: ActivityPageProps) {
  const id = BigInt(activityId);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const {
    accountEncryption,
    publicKey,
    runWithPrivateKey,
    unlocked,
  } = useKeyVault();
  const { pushToast } = useToast();
  const tracked = useTrackedTransaction();
  const [recentAssetId, setRecentAssetId] = useState<string | null>(null);
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;

  useEffect(() => {
    const key = `activity-photo-recent-asset-v2:${activityId}`;
    const recent = window.sessionStorage.getItem(key);
    if (recent) {
      setRecentAssetId(recent);
      window.sessionStorage.removeItem(key);
    }
  }, [activityId]);

  const activityQuery = useQuery({
    queryKey: ["activity", activityId, REGISTRY_ADDRESS],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        REGISTRY_ADDRESS,
    ),
    queryFn: () =>
      readActivity(publicClient as unknown as PublicClient, id),
  });

  const accessQuery = useQuery({
    queryKey: ["activity-access", activityId, address],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        address &&
        REGISTRY_ADDRESS,
    ),
    queryFn: async () => {
      const client = publicClient as unknown as PublicClient;
      const [canPublish, canView] = await Promise.all([
        client.readContract({
          address: requireRegistryAddress(),
          abi: ACTIVITY_PHOTO_REGISTRY_ABI,
          functionName: "canPublish",
          args: [id, address!],
        }),
        client.readContract({
          address: requireRegistryAddress(),
          abi: ACTIVITY_PHOTO_REGISTRY_ABI,
          functionName: "canView",
          args: [id, address!],
        }),
      ]);
      return { canPublish: Boolean(canPublish), canView: Boolean(canView) };
    },
  });

  const photosQuery = useQuery({
    queryKey: ["activity-photos", activityId, REGISTRY_ADDRESS],
    enabled: Boolean(publicClient && accessQuery.data?.canView),
    refetchOnMount: "always",
    queryFn: () =>
      listActivityPhotos(publicClient as unknown as PublicClient, id),
  });

  const keyRegistered = Boolean(accountEncryption && publicKey);
  const isOwner =
    Boolean(address && activityQuery.data) &&
    address!.toLowerCase() === activityQuery.data!.owner.toLowerCase();
  const needsKeyManifest =
    activityQuery.data?.keyManifestTxId === `0x${"0".repeat(64)}`;
  const busy = [
    "preflight",
    "awaiting_wallet",
    "pending",
    "checking",
    "business_verifying",
  ].includes(tracked.state.status);

  async function initializeKeys() {
    if (
      !publicClient ||
      !activityQuery.data ||
      !address ||
      !publicKey ||
      !unlocked
    ) {
      pushToast({
        tone: "info",
        title: "请先在右上角解锁安全密码",
      });
      return;
    }

    try {
      await runWithPrivateKey(async (_privateKey, assertSessionCurrent) => {
        const pendingManifestKey = `activity-photo-pending-manifest-v2-${activityId}`;
        const pendingRaw = localStorage.getItem(pendingManifestKey);
        let manifest: KeyManifest;
        if (pendingRaw) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(pendingRaw) as unknown;
          } catch {
            parsed = null;
          }
          if (
            !isKeyManifest(parsed) ||
            parsed.activityId !== activityId ||
            parsed.activeEpoch !== activityQuery.data.keyEpoch
          ) {
            localStorage.removeItem(pendingManifestKey);
            throw new Error("本地保存的待发布密钥清单无效");
          }
          manifest = parsed;
        } else {
          const activityKey = generateActivityKey();
          manifest = createEmptyManifest(activityId, activityQuery.data.keyEpoch);
          try {
            manifest = await grantActivityKey(
              manifest,
              activityQuery.data.keyEpoch,
              activityKey,
              address,
              publicKey,
            );
          } finally {
            activityKey.fill(0);
          }
          localStorage.setItem(pendingManifestKey, JSON.stringify(manifest));
        }

        assertSessionCurrent();
        const uploaded = await uploadKeyManifest(manifest);
        assertSessionCurrent();
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "initialize-keys",
          resourceId: activityId,
          context: {
            keyManifestTxId: uploaded.txId,
            keyManifestHash: uploaded.manifestHash,
            keyEpoch: manifest.activeEpoch,
          },
          preflight: async () => {
            assertSessionCurrent();
            const current = await readActivity(
              publicClient as unknown as PublicClient,
              id,
            );
            return current.keyManifestTxId !== `0x${"0".repeat(64)}`
              ? { satisfied: true, result: current }
              : { satisfied: false };
          },
          send: () => {
            assertSessionCurrent();
            return writeContractAsync({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName: "updateKeyManifest",
              args: [
                id,
                manifest.activeEpoch,
                uploaded.txId,
                uploaded.manifestHash,
              ],
            });
          },
          verify: async () => {
            const current = await readActivity(
              publicClient as unknown as PublicClient,
              id,
            );
            if (
              current.keyManifestTxId.toLowerCase() !== uploaded.txId.toLowerCase() ||
              current.keyManifestHash.toLowerCase() !==
                uploaded.manifestHash.toLowerCase()
            ) {
              throw new Error("交易已上链，但密钥清单引用尚未匹配");
            }
            return current;
          },
        });

        localStorage.removeItem(pendingManifestKey);
      });

      await activityQuery.refetch();
      pushToast({ tone: "success", title: "活动密钥清单已初始化" });
    } catch (error) {
      const failure = describeTransactionError(
        error,
        ACTIVITY_PHOTO_REGISTRY_ABI,
      );
      pushToast({
        tone: "error",
        title: failure.title,
        description: failure.description,
      });
    }
  }

  if (!isConnected) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <h2>连接钱包查看活动</h2>
        <p>活动列表、时间线和照片权限都由当前钱包地址决定。</p>
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <div className="setup-panel">
        <ShieldCheck size={28} />
        <h2>请切换到 {TARGET_CHAIN.name}</h2>
        <p>当前网络不包含这个活动，切换后会自动重新读取权限。</p>
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

  if (activityQuery.isError || !activityQuery.data) {
    const decoded = decodeContractError(
      activityQuery.error,
      ACTIVITY_PHOTO_REGISTRY_ABI,
    );
    const notFound = decoded?.errorName === "ActivityNotFound";
    return (
      <div className="setup-panel setup-panel-error">
        <p className="eyebrow">
          {notFound ? "ACTIVITY NOT FOUND" : "READ ERROR"}
        </p>
        <h2>
          {notFound
            ? "活动不存在或本地链已重置"
            : "暂时无法读取此活动"}
        </h2>
        <p>
          {notFound
            ? `链上未找到活动 #${activityId}，它可能来自已重置的本地开发链。`
            : "请不要重复提交操作；检查钱包网络后重试。"}
        </p>
        <div className="page-actions">
          {!notFound ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => activityQuery.refetch()}
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

  if (accessQuery.isError) {
    return (
      <div className="setup-panel setup-panel-error">
        <p className="eyebrow">ACCESS CHECK FAILED</p>
        <h2>暂时无法确认活动权限</h2>
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

  const activity = activityQuery.data;
  const canPublish = accessQuery.data?.canPublish ?? false;
  const canView = accessQuery.data?.canView ?? false;

  if (!canPublish && !canView) {
    return (
      <div className="setup-panel">
        <LockKeyhole size={28} />
        <p className="eyebrow">ACCESS DENIED</p>
        <h2>当前钱包没有活动访问权限</h2>
        <p>这个活动不会出现在你的列表中，也不会展示名称、时间线或照片索引。</p>
        <Link className="button button-secondary" href="/">
          <ArrowLeft size={16} />
          返回活动列表
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        所有活动
      </Link>

      <div className="activity-header">
        <div>
          <p className="eyebrow">ACTIVITY VAULT / #{activityId.padStart(3, "0")}</p>
          <h1>{activity.name}</h1>
          <p>
            所有者 {shortAddress(activity.owner)} · 创建于 {formatUnixDate(activity.createdAt)} ·
            密钥代际 {activity.keyEpoch}
          </p>
        </div>
        <div className="page-actions">
          {canPublish ? (
            <Link className="button button-primary" href={`/activities/${activityId}/upload`}>
              <Upload size={16} />
              上传照片
            </Link>
          ) : null}
          {isOwner ? (
            <Link className="button button-secondary" href={`/activities/${activityId}/members`}>
              <Users size={16} />
              成员与密钥
            </Link>
          ) : null}
        </div>
      </div>

      <div className="activity-meta-strip">
        <span className={canPublish ? "badge badge-green" : "badge"}>
          <Camera size={12} />
          {canPublish ? "可上传" : "只读"}
        </span>
        <span className={canView ? "badge badge-blue" : "badge badge-amber"}>
          {canView ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}
          {canView ? "可查看" : "无查看权"}
        </span>
        <span>
          <KeyRound size={13} />
          清单 {activity.keyManifestTxId === `0x${"0".repeat(64)}` ? "未初始化" : "已发布"}
        </span>
        <span>
          <Settings2 size={13} />
          {activity.owner.toLowerCase() === address?.toLowerCase() ? "所有者" : "成员"}
        </span>
      </div>

      {isOwner && needsKeyManifest ? (
        <div className="callout callout-warning section-gap key-init-banner">
          <KeyRound size={19} />
          <div>
            <strong>活动密钥清单尚未初始化</strong>
            <p>
              在未初始化前，成员无法获得照片密钥。发布清单不会重新生成安全密码。
            </p>
          </div>
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={busy || !unlocked || !keyRegistered}
            onClick={initializeKeys}
          >
            {busy ? <LoaderCircle className="spin" size={15} /> : <KeyRound size={15} />}
            初始化
          </button>
        </div>
      ) : null}

      <TransactionStatusNotice
        state={tracked.state}
        onCheck={() => void tracked.check()}
      />

      {photosQuery.isLoading ? (
        <div className="loading-panel">
          <LoaderCircle className="spin" size={22} />
          正在读取照片时间线
        </div>
      ) : photosQuery.isError ? (
        <div className="empty-state section-gap empty-state-reveal">
          <CircleAlert size={25} />
          <p className="eyebrow">TIMELINE UNAVAILABLE</p>
          <h2>暂时无法读取照片时间线</h2>
          <p>当前只是读取失败，不代表活动没有照片。请检查网络后重试。</p>
          <button
            className="button button-secondary"
            type="button"
            disabled={photosQuery.isFetching}
            onClick={() => void photosQuery.refetch()}
          >
            {photosQuery.isFetching ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            重新读取
          </button>
        </div>
      ) : photosQuery.data?.length ? (
        <div className="album-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TIMELINE</p>
              <h2>{photosQuery.data.length} 张照片</h2>
            </div>
            <span>按拍摄时间倒序</span>
          </div>
          <div className="photo-grid">
            {photosQuery.data.map(({ assetId, photo, capsule }, index) =>
              address && unlocked ? (
                <PhotoCard
                  key={assetId}
                  assetId={assetId}
                  photo={photo}
                  capsule={capsule}
                  activity={activity}
                  activityId={activityId}
                  account={address}
                  index={index}
                  highlighted={assetId === recentAssetId}
                />
              ) : (
                <article
                  key={assetId}
                  className="photo-card photo-card-locked photo-card-reveal is-visible"
                  style={{ "--reveal-delay": `${Math.min(index, 12) * 35}ms` } as CSSProperties}
                >
                  <span className="photo-locked photo-state-fade">
                    <LockKeyhole size={21} />
                    <span>请先在右上角解锁安全密码</span>
                  </span>
                </article>
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state section-gap empty-state-reveal">
          <Camera size={25} />
          <p className="eyebrow">EMPTY ALBUM</p>
          <h2>这个活动还没有照片</h2>
          <p>第一张照片发布后，会以不可变记录出现在这里。</p>
          {canPublish ? (
            <Link className="button button-primary" href={`/activities/${activityId}/upload`}>
              <Upload size={16} />
              上传第一张照片
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
