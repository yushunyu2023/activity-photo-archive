"use client";

import {
  ArrowRight,
  CalendarDays,
  Images,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { PublicClient } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { useKeyVault } from "@/components/key-vault-provider";
import { REGISTRY_ADDRESS } from "@/lib/contract";
import { listActivitiesForAccount } from "@/lib/activity-queries";
import { shortAddress } from "@/lib/format";
import { TARGET_CHAIN, TARGET_CHAIN_ID } from "@/lib/wagmi";

export function HomeDashboard() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { accountEncryptionStatus, unlocked } = useKeyVault();
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;

  const activitiesQuery = useQuery({
    queryKey: ["activities", address, REGISTRY_ADDRESS],
    queryFn: async () => {
      if (!publicClient || !address) return [];
      return listActivitiesForAccount(publicClient as unknown as PublicClient, address);
    },
    enabled: Boolean(publicClient && address && REGISTRY_ADDRESS && !wrongNetwork),
  });
  const ownedActivity = activitiesQuery.data?.find(
    (membership) =>
      membership.activity.owner.toLowerCase() === address?.toLowerCase(),
  );

  if (!isConnected) {
    return (
      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">ACTIVITY PHOTO ARCHIVE</p>
          <h1>把活动记忆留在可验证的时间里。</h1>
          <p>
            连接 EVM 钱包后创建活动、邀请上传者和查看者。照片在浏览器端加密，
            Base 保存权限索引，Arweave 保存密文。
          </p>
          <Link className="button button-primary" href="/activities/new">
            <Plus size={17} />
            开始创建活动
          </Link>
        </div>
        <div className="welcome-ledger" aria-label="归档流程">
          <div className="ledger-row">
            <span>01</span>
            <ShieldCheck size={20} />
            <div>
              <strong>浏览器端加密</strong>
              <p>原始照片在本机完成 AES-256-GCM 加密。</p>
            </div>
          </div>
            <div className="ledger-row">
            <span>02</span>
            <KeyRound size={20} />
            <div>
              <strong>活动密钥授权</strong>
              <p>查看者取得封装密钥后才能解密。</p>
            </div>
          </div>
          <div className="ledger-row">
            <span>03</span>
            <CalendarDays size={20} />
            <div>
              <strong>不可变时间线</strong>
              <p>拍摄时间、描述和照片哈希只追加、不修改。</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MY ACTIVITIES</p>
          <h1>活动相册</h1>
          <p>
            当前钱包 {address ? shortAddress(address) : ""}。权限和照片索引来自{" "}
            {TARGET_CHAIN.name}。
          </p>
        </div>
        <div className="page-actions">
          <span className="badge">
            <KeyRound size={14} />
            {unlocked
              ? "安全密码已解锁"
              : accountEncryptionStatus === "checking"
                ? "正在确认安全密码"
                : accountEncryptionStatus === "unregistered"
                  ? "尚未设置安全密码"
                  : accountEncryptionStatus === "read_error"
                    ? "安全密码状态读取失败"
                    : accountEncryptionStatus === "incompatible"
                      ? "安全密码记录不兼容"
                      : accountEncryptionStatus === "wrong_network"
                        ? "钱包网络不正确"
                        : "安全密码已锁定"}
          </span>
          {ownedActivity ? (
            <Link
              className="button button-secondary"
              href={`/activities/${ownedActivity.activityId.toString()}`}
            >
              <ArrowRight size={17} />
              查看我的活动
            </Link>
          ) : (
            <Link
              className={wrongNetwork ? "button button-disabled" : "button button-primary"}
              href={wrongNetwork ? "#" : "/activities/new"}
              aria-disabled={wrongNetwork}
              onClick={(event) => {
                if (wrongNetwork) event.preventDefault();
              }}
            >
              <Plus size={17} />
              创建活动
            </Link>
          )}
        </div>
      </div>

      {!REGISTRY_ADDRESS ? (
        <div className="setup-panel">
          <p className="eyebrow">CONFIGURATION REQUIRED</p>
          <h2>尚未连接活动注册表</h2>
          <p>
            在 `dapp/.env.local` 中设置 `NEXT_PUBLIC_CONTRACT_ADDRESS`，并把部署区块写入
            `NEXT_PUBLIC_DEPLOY_BLOCK`。
          </p>
          <code>NEXT_PUBLIC_CONTRACT_ADDRESS=0x...</code>
        </div>
      ) : wrongNetwork ? (
        <div className="setup-panel">
          <p className="eyebrow">WRONG NETWORK</p>
          <h2>请切换到 {TARGET_CHAIN.name}</h2>
          <p>点击右上角网络按钮切换后，活动列表会自动刷新。</p>
        </div>
      ) : activitiesQuery.isLoading ? (
        <div className="loading-panel">
          <LoaderCircle className="spin" size={22} />
          正在从链上读取活动
        </div>
      ) : activitiesQuery.isError ? (
        <div className="setup-panel setup-panel-error">
          <p className="eyebrow">READ ERROR</p>
          <h2>活动列表读取失败</h2>
          <p>{activitiesQuery.error instanceof Error ? activitiesQuery.error.message : "请检查网络"}</p>
          <button className="button button-secondary" type="button" onClick={() => activitiesQuery.refetch()}>
            重试
          </button>
        </div>
      ) : activitiesQuery.data?.length ? (
        <div className="activity-grid">
          {activitiesQuery.data.map((membership) => (
            <Link
              className="activity-card"
              href={`/activities/${membership.activityId.toString()}`}
              key={membership.activityId.toString()}
            >
              <div className="activity-card-top">
                <div className="activity-number">
                  <Images size={18} />
                  <span>#{membership.activityId.toString().padStart(3, "0")}</span>
                </div>
                <span className="activity-card-arrow">
                  <ArrowRight size={17} />
                </span>
              </div>
              <div className="activity-card-body">
                <p className="eyebrow">ACTIVITY VAULT</p>
                <h2>{membership.activity.name}</h2>
                <p>所有者 {shortAddress(membership.activity.owner)}</p>
              </div>
              <div className="activity-card-footer">
                <div className="role-list">
                  {membership.activity.owner.toLowerCase() ===
                  address?.toLowerCase() ? (
                    <span className="badge badge-green">所有者</span>
                  ) : membership.canPublish ? (
                    <span className="badge badge-green">上传者</span>
                  ) : (
                    <span className="badge badge-blue">查看者</span>
                  )}
                  {!membership.canView ? (
                    <span className="badge badge-amber">
                      <KeyRound size={12} />
                      无查看授权
                    </span>
                  ) : null}
                </div>
                <span>密钥代际 {membership.activity.keyEpoch}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">
            <Users size={25} />
          </div>
          <p className="eyebrow">NO ACTIVITY YET</p>
          <h2>这个钱包还没有活动</h2>
          <p>创建第一个活动，随后添加可信上传者和查看者。</p>
          {!ownedActivity ? (
            <Link className="button button-primary" href="/activities/new">
              <Plus size={17} />
              创建活动
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
