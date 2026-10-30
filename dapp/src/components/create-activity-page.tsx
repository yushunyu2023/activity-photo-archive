"use client";

import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
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
  countActivityNameCharacters,
  MAX_ACTIVITY_NAME_CHARACTERS,
  normalizeActivityName,
  validateActivityName,
} from "@/lib/activity-name";
import { describeTransactionError } from "@/lib/transaction-errors";
import { TARGET_CHAIN } from "@/lib/wagmi";

export function CreateActivityPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const {
    accountEncryptionStatus,
    runWithPrivateKey,
    unlocked,
  } = useKeyVault();
  const { pushToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tracked = useTrackedTransaction();
  const [error, setError] = useState<string | null>(null);
  const [activityName, setActivityName] = useState("");

  const {
    data: ownedActivityId,
    isLoading: ownedActivityLoading,
    isError: ownedActivityError,
    refetch: refetchOwnedActivity,
  } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getActivityIdByOwner",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && REGISTRY_ADDRESS) },
  });

  const keyRegistered = accountEncryptionStatus === "registered";
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;
  const alreadyOwnsActivity = Boolean(ownedActivityId && ownedActivityId > 0n);
  const checkingOwnership = Boolean(
    address && REGISTRY_ADDRESS && ownedActivityLoading,
  );
  const activityNameError = validateActivityName(activityName);
  const busy = [
    "preflight",
    "awaiting_wallet",
    "pending",
    "checking",
    "business_verifying",
  ].includes(tracked.state.status);
  const ready =
    isConnected &&
    !wrongNetwork &&
    unlocked &&
    keyRegistered &&
    !alreadyOwnsActivity &&
    !checkingOwnership &&
    !ownedActivityError &&
    !activityNameError &&
    REGISTRY_ADDRESS &&
    publicClient;

  async function createActivity() {
    if (!ready || !address || !publicClient) return;
    setError(null);

    try {
      const activityId = await runWithPrivateKey(
        async (_privateKey, assertSessionCurrent) => {
          const resourceId = `${chainId}:${address.toLowerCase()}`;
          return tracked.execute<bigint>({
            publicClient: publicClient as unknown as PublicClient,
            chainId,
            account: address,
            action: "create-activity",
            resourceId,
            preflight: async () => {
              assertSessionCurrent();
              const existing = (await publicClient.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "getActivityIdByOwner",
                args: [address],
              })) as bigint;
              return existing > 0n
                ? { satisfied: true, result: existing }
                : { satisfied: false };
            },
            send: () => {
              assertSessionCurrent();
              return writeContractAsync({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "createActivity",
                args: [normalizeActivityName(activityName)],
              });
            },
            verify: async () => {
              const created = (await publicClient.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "getActivityIdByOwner",
                args: [address],
              })) as bigint;
              if (created === 0n) {
                throw new Error("交易已上链，但活动所有者状态尚未生效");
              }
              return created;
            },
          });
        },
      );

      await queryClient.invalidateQueries();
      pushToast({
        tone: "success",
        title: alreadyOwnsActivity ? "已找到现有活动" : "活动已创建",
        description: "正在进入活动页完成密钥清单初始化。",
      });
      router.push(`/activities/${activityId.toString()}`);
    } catch (cause) {
      const failure = describeTransactionError(
        cause,
        ACTIVITY_PHOTO_REGISTRY_ABI,
      );
      setError(failure.description);
      pushToast({
        tone: "error",
        title: failure.title,
        description: failure.description,
      });
    }
  }

  return (
    <div className="create-activity-layout">
      <div className="create-activity-main">
        <Link className="back-link" href="/">
          <ArrowLeft size={15} />
          返回活动列表
        </Link>
        <p className="eyebrow">NEW ACTIVITY</p>
        <h1>创建活动保险箱</h1>
        <p className="lead-copy">
          每个活动拥有独立的上传者、查看者和内容密钥。活动创建后，照片只能追加，不能修改。
        </p>

        <div className="step-list">
          <div className={isConnected ? "step step-done" : "step"}>
            <span className="step-number">01</span>
            <div>
              <strong>连接 Base 钱包</strong>
              <p>{isConnected ? "钱包已连接" : "使用右上角钱包按钮连接"}</p>
            </div>
            <Wallet size={19} />
          </div>
          <div className={unlocked ? "step step-done" : "step"}>
            <span className="step-number">02</span>
            <div>
              <strong>解锁安全密码</strong>
              <p>{unlocked ? "安全密码已解锁" : "请先在右上角完成解锁"}</p>
            </div>
            <KeyRound size={19} />
          </div>
          <div className={keyRegistered ? "step step-done" : "step"}>
            <span className="step-number">03</span>
            <div>
              <strong>设置安全密码</strong>
              <p>
                {keyRegistered
                  ? "安全密码已登记"
                  : "请先在右上角设置安全密码"}
              </p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <div className="step">
            <span className="step-number">04</span>
            <div>
              <strong>创建活动</strong>
              <p>创建成功后进入活动页初始化密钥清单。</p>
            </div>
            <KeyRound size={19} />
          </div>
        </div>

        {alreadyOwnsActivity && ownedActivityId ? (
          <div className="callout callout-warning section-gap">
            <ShieldCheck size={18} />
            <div>
              <p>当前钱包已经拥有一个活动，每个地址最多创建一个活动。</p>
              <Link href={`/activities/${ownedActivityId.toString()}`}>
                进入活动 #{ownedActivityId.toString()}
              </Link>
            </div>
          </div>
        ) : null}

        {checkingOwnership ? (
          <div className="loading-panel section-gap">
            <LoaderCircle className="spin" size={20} />
            正在检查当前地址是否已有活动
          </div>
        ) : ownedActivityError ? (
          <div className="callout callout-danger section-gap">
            <KeyRound size={18} />
            <div>
              <p>无法确认当前地址是否已有活动，因此暂不显示创建入口。</p>
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={() => void refetchOwnedActivity()}
              >
                重新检查
              </button>
            </div>
          </div>
        ) : !alreadyOwnsActivity ? (
          <>
            <label className="field activity-name-field">
              <span>
                活动名称
                <small
                  className={
                    countActivityNameCharacters(normalizeActivityName(activityName)) >
                    MAX_ACTIVITY_NAME_CHARACTERS
                      ? "field-count-error"
                      : undefined
                  }
                >
                  {countActivityNameCharacters(normalizeActivityName(activityName))}/
                  {MAX_ACTIVITY_NAME_CHARACTERS}
                </small>
              </span>
              <input
                className="text-input"
                value={activityName}
                onChange={(event) => setActivityName(event.target.value)}
                placeholder="例如：小林一家"
                maxLength={40}
              />
              {activityName && activityNameError ? (
                <span className="field-hint field-count-error">{activityNameError}</span>
              ) : null}
            </label>

            <TransactionStatusNotice
              state={tracked.state}
              onCheck={() => void tracked.check()}
            />
            {error ? (
              <div className="callout callout-danger create-error">
                <KeyRound size={18} />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="create-actions">
              <button
                className="button button-primary button-large"
                type="button"
                disabled={!ready || busy}
                onClick={createActivity}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {busy ? "正在创建活动" : "创建活动"}
                {!busy ? <ArrowRight size={17} /> : null}
              </button>
              {wrongNetwork ? (
                <span className="field-hint">请先切换到 {TARGET_CHAIN.name}。</span>
              ) : !unlocked ? (
                <span className="field-hint">请先在右上角解锁安全密码。</span>
              ) : !keyRegistered ? (
                <span className="field-hint">请先在右上角设置安全密码。</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <aside className="create-activity-aside">
        <p className="eyebrow">WHAT HAPPENS</p>
        <h2>链上只保存索引</h2>
        <p>
          照片和描述不会进入 Base。合约记录活动所有者、成员、内容哈希和 Arweave
          地址。
        </p>
        <div className="aside-rule" />
        <dl>
          <div>
            <dt>活动内容密钥</dt>
            <dd>32 字节随机密钥，分层派生每张照片密钥。</dd>
          </div>
          <div>
            <dt>安全密码</dt>
            <dd>密码只在本地派生解密身份，Base 只保存公开参数。</dd>
          </div>
          <div>
            <dt>失败恢复</dt>
            <dd>创建成功后进入活动页；未完成的链上操作可手动只读检查。</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
