"use client";

import {
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import type { Address, PublicClient } from "viem";
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
  parseAccountEncryptionRecord,
  type AccountEncryptionRecordLookup,
} from "@/lib/account-encryption-state";
import { evaluateAccountPassword } from "@/lib/password-strength";
import { describeTransactionError } from "@/lib/transaction-errors";
import { TrackedTransactionError } from "@/lib/transaction-tracking";
import type { AccountEncryptionRecord } from "@/lib/types";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";

export function VaultDialog() {
  const {
    accountEncryptionStatus,
    dialogOpen,
    unlocked,
    closeDialog,
    prepareAccountEncryption,
    completeAccountEncryptionRegistration,
    discardPendingAccountEncryptionSetup,
    unlock,
    lock,
    refetchAccountEncryption,
    runWithPrivateKey,
  } = useKeyVault();
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { pushToast } = useToast();
  const tracked = useTrackedTransaction();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const strength = useMemo(
    () => evaluateAccountPassword(password, { walletAddress: address }),
    [address, password],
  );
  const busy = [
    "preflight",
    "awaiting_wallet",
    "pending",
    "checking",
    "business_verifying",
  ].includes(tracked.state.status);

  if (!dialogOpen) return null;

  async function readCurrentRecord(
    walletAddress: Address,
  ): Promise<AccountEncryptionRecordLookup> {
    if (!publicClient) throw new Error("RPC 尚未就绪");
    const result = await publicClient.readContract({
      address: requireRegistryAddress(),
      abi: ACTIVITY_PHOTO_REGISTRY_ABI,
      functionName: "getAccountEncryption",
      args: [walletAddress],
    });
    return parseAccountEncryptionRecord(result);
  }

  async function setup(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    if (!address || !publicClient || !REGISTRY_ADDRESS) {
      setLocalError("请先连接目标网络的钱包");
      return;
    }
    if (chainId !== TARGET_CHAIN_ID) {
      setLocalError("请切换到正确的网络");
      return;
    }
    if (!strength.acceptable) {
      setLocalError(strength.issues[0] ?? "安全密码强度不足");
      return;
    }
    if (password !== confirmation) {
      setLocalError("两次输入的安全密码不一致");
      return;
    }
    if (!acknowledged) {
      setLocalError("请确认你已妥善保存密码并理解密码无法找回");
      return;
    }

    let preparedPublicKey: `0x${string}` | null = null;
    try {
      const prepared = await prepareAccountEncryption(password);
      preparedPublicKey = prepared.publicKey;
      setPassword("");
      setConfirmation("");
      setShowPassword(false);

      const record = await runWithPrivateKey(
        async (_privateKey, assertSessionCurrent) =>
          tracked.execute<AccountEncryptionRecord>({
            publicClient: publicClient as unknown as PublicClient,
            chainId,
            account: address,
            action: "account-encryption",
            resourceId: address.toLowerCase(),
            context: {
              publicKey: prepared.publicKey,
              kdfSalt: prepared.kdfSalt,
              kdfVersion: prepared.kdfVersion,
              schemaVersion: prepared.encryptionSchemaVersion,
            },
            preflight: async () => {
              assertSessionCurrent();
              const existing = await readCurrentRecord(address);
              if (existing.kind === "incompatible") {
                throw new Error("当前地址存在不兼容的安全密码记录，请勿覆盖");
              }
              if (existing.kind === "unregistered") {
                return { satisfied: false };
              }
              if (
                existing.record.publicKey.toLowerCase() !==
                prepared.publicKey.toLowerCase()
              ) {
                throw new Error("当前地址已经登记另一份安全密码，不能覆盖");
              }
              return { satisfied: true, result: existing.record };
            },
            send: () => {
              assertSessionCurrent();
              return writeContractAsync({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "registerAccountEncryption",
                args: [
                  prepared.publicKey,
                  prepared.kdfSalt,
                  prepared.kdfVersion,
                  prepared.encryptionSchemaVersion,
                ],
              });
            },
            verify: async () => {
              const current = await readCurrentRecord(address);
              if (
                current.kind !== "registered" ||
                current.record.publicKey.toLowerCase() !==
                  prepared.publicKey.toLowerCase()
              ) {
                throw new Error("交易已上链，但链上安全密码记录尚未生效");
              }
              return current.record;
            },
          }),
      );
      completeAccountEncryptionRegistration(record);

      await refetchAccountEncryption();
      pushToast({
        tone: "success",
        title: "安全密码已登记",
        description: "安全密码保护已锁定，需要时请从右上角重新解锁。",
      });
    } catch (error) {
      const failure = describeTransactionError(
        error,
        ACTIVITY_PHOTO_REGISTRY_ABI,
      );
      if (!address) {
        lock();
        setLocalError(failure.description);
        return;
      }

      try {
        const current = await readCurrentRecord(address);
        if (current.kind === "registered" && preparedPublicKey) {
          if (
            current.record.publicKey.toLowerCase() ===
            preparedPublicKey.toLowerCase()
          ) {
            completeAccountEncryptionRegistration(current.record);
            await refetchAccountEncryption();
            pushToast({
              tone: "success",
              title: "安全密码已登记",
              description: "链上记录已确认，请重新输入安全密码解锁。",
            });
            return;
          }

          discardPendingAccountEncryptionSetup();
          setLocalError(
            "当前地址已经登记另一份安全密码，不能覆盖。请使用当时登记的安全密码解锁。",
          );
          return;
        }

        if (current.kind === "incompatible") {
          lock();
          setLocalError(
            "当前地址的安全密码记录版本不兼容。为避免覆盖，DApp 不会重新设置。",
          );
          return;
        }

        if (
          error instanceof TrackedTransactionError &&
          (error.status === "rejected" || error.status === "failed")
        ) {
          discardPendingAccountEncryptionSetup();
          setLocalError(
            `${failure.description} 本次设置未登记，可以重新设置安全密码。`,
          );
          return;
        }

        lock();
        setLocalError(
          `${failure.description} 登记结果暂未确认，请先重新检查链上状态，不要重复发起交易。`,
        );
      } catch {
        lock();
        setLocalError(
          `${failure.description} 暂时无法确认链上登记结果，请恢复 RPC 后重新检查。`,
        );
      }
    }
  }

  async function handleUnlock(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    try {
      await unlock(password);
      setPassword("");
      setShowPassword(false);
      tracked.reset();
      pushToast({ tone: "success", title: "安全密码已解锁" });
      closeDialog();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : "安全密码不正确",
      );
    }
  }

  async function retryAccountStatus() {
    setLocalError(null);
    try {
      await refetchAccountEncryption();
    } catch {
      setLocalError("安全密码状态读取失败，请检查 RPC 后重试。");
    }
  }

  function close() {
    if (busy) return;
    setLocalError(null);
    setPassword("");
    setConfirmation("");
    setShowPassword(false);
    closeDialog();
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={close}>
      <div
        className="dialog vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">SECURITY PASSWORD</p>
            <h2 id="vault-title">
              {accountEncryptionStatus === "disconnected"
                ? "请先连接钱包"
                : accountEncryptionStatus === "wrong_network"
                  ? "请切换钱包网络"
                  : accountEncryptionStatus === "checking"
                    ? "正在确认安全密码状态"
                    : accountEncryptionStatus === "read_error"
                      ? "安全密码状态读取失败"
                      : accountEncryptionStatus === "incompatible"
                        ? "安全密码记录不兼容"
                        : accountEncryptionStatus === "unregistered"
                          ? "设置安全密码"
                          : unlocked
                            ? "安全密码"
                            : "解锁安全密码"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            disabled={busy}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>

        {accountEncryptionStatus === "disconnected" ? (
          <div className="stack-form">
            <div className="callout callout-neutral">
              <Wallet size={20} />
              <p>连接钱包后才能确认此地址是否已经登记安全密码。</p>
            </div>
          </div>
        ) : accountEncryptionStatus === "wrong_network" ? (
          <div className="stack-form">
            <div className="callout callout-warning">
              <CircleAlert size={20} />
              <p>请先在钱包中切换到正确网络，再设置或解锁安全密码。</p>
            </div>
          </div>
        ) : accountEncryptionStatus === "checking" ? (
          <div className="stack-form">
            <div className="loading-panel">
              <LoaderCircle className="spin" size={22} />
              正在确认此钱包的安全密码状态
            </div>
          </div>
        ) : accountEncryptionStatus === "read_error" ? (
          <div className="stack-form">
            <div className="callout callout-danger">
              <CircleAlert size={20} />
              <p>
                暂时无法读取链上安全密码状态。为避免误创建设置流程，DApp
                不会把读取失败当成未登记。
              </p>
            </div>
            {localError ? <p className="field-hint">{localError}</p> : null}
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void retryAccountStatus()}
            >
              <RefreshCw size={16} />
              重新读取账户状态
            </button>
          </div>
        ) : accountEncryptionStatus === "incompatible" ? (
          <div className="stack-form">
            <div className="callout callout-danger">
              <CircleAlert size={20} />
              <p>
                当前地址存在无法识别或不兼容的安全密码记录。为避免覆盖历史身份，请勿重新设置。
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void retryAccountStatus()}
            >
              <RefreshCw size={16} />
              重新检查链上记录
            </button>
          </div>
        ) : accountEncryptionStatus === "unregistered" ? (
          <form className="stack-form" onSubmit={setup}>
            <div className="callout callout-warning">
              <ShieldCheck size={20} />
              <p>
                请务必牢记并单独保护安全密码。安全密码无法修改或找回；忘记或泄露后，
                即使仍拥有钱包，也无法安全恢复该地址的历史加密内容。
              </p>
            </div>
            <label className="field">
              <span>设置安全密码</span>
              <div className="password-input-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="12 至 128 个字符，建议使用长密码或多个词语"
                />
                <button
                  type="button"
                  className="icon-button icon-button-small"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <div className="password-strength" data-score={strength.score}>
              <span>密码强度：{strength.label}</span>
              <div aria-hidden="true">
                {[1, 2, 3, 4].map((level) => (
                  <i
                    className={strength.score >= level ? "is-active" : ""}
                    key={level}
                  />
                ))}
              </div>
              {strength.issues.length ? (
                <small>{strength.issues.slice(0, 2).join("；")}</small>
              ) : (
                <small>请使用只有自己知道的长密码，并允许密码管理器保存。</small>
              )}
            </div>
            <label className="field">
              <span>再次输入安全密码</span>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="再次输入"
              />
            </label>
            <label className="password-confirmation">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                我已使用独立强密码并妥善记录。忘记安全密码后，平台、客服和钱包都无法找回。
              </span>
            </label>
            <TransactionStatusNotice
              state={tracked.state}
              onCheck={() => void tracked.check()}
            />
            {localError ? (
              <div className="callout callout-danger">
                <KeyRound size={18} />
                <p>{localError}</p>
              </div>
            ) : null}
            <button
              className="button button-primary"
              type="submit"
              disabled={
                busy ||
                !strength.acceptable ||
                password !== confirmation ||
                !acknowledged
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              设置并登记安全密码
            </button>
          </form>
        ) : unlocked ? (
          <div className="stack-form">
            <div className="callout callout-success">
              <ShieldCheck size={20} />
              <p>安全密码已解锁，可用于解密活动照片和密钥授权。</p>
            </div>
            <div className="vault-key-preview">
              <KeyRound size={22} />
              <div>
                <span>会话状态</span>
                <strong>安全密码已解锁</strong>
              </div>
            </div>
            <button
              className="button button-ghost"
              type="button"
              onClick={() => {
                lock();
                close();
              }}
            >
              <LockKeyhole size={16} />
              立即锁定
            </button>
          </div>
        ) : (
          <form className="stack-form" onSubmit={handleUnlock}>
            <div className="callout callout-neutral">
              <ShieldCheck size={20} />
              <p>
                安全密码只用于在当前页面派生解密身份，不会上传、写入浏览器存储或链上。
              </p>
            </div>
            <label className="field">
              <span>输入安全密码</span>
              <div className="password-input-wrap">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入安全密码"
                />
                <button
                  type="button"
                  className="icon-button icon-button-small"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            {localError ? (
              <div className="callout callout-danger">
                <KeyRound size={18} />
                <p>{localError}</p>
              </div>
            ) : null}
            <button
              className="button button-primary"
              type="submit"
              disabled={!password || busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <KeyRound size={17} />
              )}
              解锁安全密码
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
