"use client";

import {
  ArrowLeft,
  ArrowUpCircle,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
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
  buildActiveRecipients,
  classifyMissingRecipientKeys,
} from "@/lib/activity-recipients";
import {
  listRemovedActivityMembers,
  readActivity,
} from "@/lib/activity-queries";
import { generateActivityKey } from "@/lib/crypto";
import { shortAddress } from "@/lib/format";
import {
  decryptKeyForEpoch,
  findGrant,
  formatEpochList,
  grantActivityKey,
  listGrantedEpochs,
  listMissingEpochs,
  loadAndVerifyKeyManifest,
  uploadKeyManifest,
} from "@/lib/key-manifest";
import {
  decodeContractError,
  describeTransactionError,
} from "@/lib/transaction-errors";
import type { KeyManifest } from "@/lib/types";
import { TARGET_CHAIN } from "@/lib/wagmi";

const MAX_ACTIVITY_MEMBERS = 20;
const ZERO_KEY = `0x${"0".repeat(64)}` as Hex;

type MemberKind = "uploader" | "viewer";

type MemberRow = {
  address: Address;
  kind: MemberKind;
};

type GrantTarget = {
  address: Address;
  kind: MemberKind;
  publicKey: Hex;
  grantedEpochs: number[];
  missingEpochs: number[];
};

function GrantEpochDialog({
  target,
  currentEpoch,
  selectedEpochs,
  busy,
  onToggle,
  onSelectAll,
  onClose,
  onConfirm,
}: {
  target: GrantTarget;
  currentEpoch: number;
  selectedEpochs: number[];
  busy: boolean;
  onToggle: (epoch: number) => void;
  onSelectAll: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const epochs = Array.from({ length: currentEpoch }, (_, index) => index + 1);
  const granted = new Set(target.grantedEpochs);
  const missing = new Set(target.missingEpochs);

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="dialog grant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grant-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <p className="eyebrow">KEY GENERATION ACCESS</p>
            <h2 id="grant-dialog-title">授权代际</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="stack-form">
          <div className="grant-target-summary">
            <div>
              <span>授权对象</span>
              <strong>{shortAddress(target.address)}</strong>
            </div>
            <div>
              <span>成员角色</span>
              <strong>
                {target.kind === "uploader" ? "上传者 · 含查看权限" : "查看者"}
              </strong>
            </div>
            <div>
              <span>安全密码</span>
              <strong className="status-success">已设置</strong>
            </div>
          </div>
          <div className="callout callout-neutral">
            <KeyRound size={18} />
            <p>
              只追加缺失代际，不撤销对方已经取得的密钥。已移除成员不能在这里重新授权。
            </p>
          </div>

          <div className="epoch-picker" role="group" aria-label="选择授权代际">
            {epochs.map((epoch) => {
              const isGranted = granted.has(epoch);
              const isMissing = missing.has(epoch);
              const checked = selectedEpochs.includes(epoch);
              return (
                <label
                  className={
                    isGranted
                      ? "epoch-option epoch-option-granted"
                      : "epoch-option"
                  }
                  key={epoch}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!isMissing || busy}
                    onChange={() => onToggle(epoch)}
                  />
                  <span>
                    第 {epoch} 代
                    <small>
                      {isGranted
                        ? "已授权"
                        : checked
                          ? "本次授权"
                          : "未授权"}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="dialog-actions">
            <button
              className="button button-ghost button-small"
              type="button"
              disabled={
                busy ||
                selectedEpochs.length === target.missingEpochs.length
              }
              onClick={onSelectAll}
            >
              选择全部缺失代际
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="button button-primary"
              type="button"
              disabled={busy || selectedEpochs.length === 0}
              onClick={onConfirm}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <KeyRound size={16} />
              )}
              确认授权
              {selectedEpochs.length
                ? `第 ${formatEpochList(selectedEpochs)} 代`
                : ""}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MembersPage({ activityId }: { activityId: string }) {
  const id = BigInt(activityId);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync } = useWriteContract();
  const {
    accountEncryption,
    accountEncryptionStatus,
    publicKey: ownPublicKey,
    runWithPrivateKey,
    unlocked,
  } = useKeyVault();
  const { pushToast } = useToast();
  const tracked = useTrackedTransaction();
  const [memberAddress, setMemberAddress] = useState("");
  const [memberKind, setMemberKind] = useState<MemberKind>("viewer");
  const [grantTarget, setGrantTarget] = useState<GrantTarget | null>(null);
  const [selectedEpochs, setSelectedEpochs] = useState<number[]>([]);
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

  const membersQuery = useQuery({
    queryKey: [
      "activity-members",
      activityId,
      REGISTRY_ADDRESS,
      activityQuery.data?.owner,
    ],
    enabled: Boolean(
      isConnected &&
        !wrongNetwork &&
        publicClient &&
        REGISTRY_ADDRESS &&
        activityQuery.data,
    ),
    queryFn: async () => {
      const client = publicClient as unknown as PublicClient;
      const registry = requireRegistryAddress();
      const [uploaders, viewers, currentCount, removedAddresses] =
        await Promise.all([
          client.readContract({
            address: registry,
            abi: ACTIVITY_PHOTO_REGISTRY_ABI,
            functionName: "getUploaders",
            args: [id],
          }),
          client.readContract({
            address: registry,
            abi: ACTIVITY_PHOTO_REGISTRY_ABI,
            functionName: "getViewers",
            args: [id],
          }),
          client.readContract({
            address: registry,
            abi: ACTIVITY_PHOTO_REGISTRY_ABI,
            functionName: "getCurrentMemberCount",
            args: [id],
          }),
          listRemovedActivityMembers(client, id),
        ]);
      const owner = activityQuery.data!.owner;
      const allAccounts = [
        ...new Set(
          [owner, ...uploaders, ...viewers, ...removedAddresses].map(
            (account) => account.toLowerCase(),
          ),
        ),
      ] as Address[];
      const accountEncryptions = await Promise.all(
        allAccounts.map(async (account) => {
          const result = (await client.readContract({
            address: registry,
            abi: ACTIVITY_PHOTO_REGISTRY_ABI,
            functionName: "getAccountEncryption",
            args: [account],
          })) as unknown as {
            publicKey: Hex;
            exists: boolean;
          };
          return [account, result] as const;
        }),
      );

      return {
        uploaders,
        viewers,
        currentCount: Number(currentCount),
        removedAddresses,
        publicKeys: Object.fromEntries(
          accountEncryptions.map(([account, result]) => [
            account.toLowerCase(),
            result.exists ? result.publicKey : ZERO_KEY,
          ]),
        ) as Record<string, Hex>,
      };
    },
  });

  const activity = activityQuery.data;
  const manifestMissing = activity?.keyManifestTxId === ZERO_KEY;

  const manifestQuery = useQuery({
    queryKey: [
      "activity-key-manifest",
      activityId,
      REGISTRY_ADDRESS,
      activity?.keyManifestTxId,
      activity?.keyManifestHash,
    ],
    enabled: Boolean(!wrongNetwork && activity && !manifestMissing),
    queryFn: () => loadAndVerifyKeyManifest(activityId, activity!),
  });

  const isOwner = Boolean(
    address && activity && activity.owner.toLowerCase() === address.toLowerCase(),
  );
  const busy = [
    "preflight",
    "awaiting_wallet",
    "pending",
    "checking",
    "business_verifying",
  ].includes(tracked.state.status);

  function showError(error: unknown, fallback: string) {
    const failure = describeTransactionError(
      error,
      ACTIVITY_PHOTO_REGISTRY_ABI,
    );
    pushToast({
      tone: "error",
      title: failure.title || fallback,
      description: failure.description,
    });
  }

  async function refreshMembers() {
    await Promise.all([
      activityQuery.refetch(),
      membersQuery.refetch(),
      manifestQuery.refetch(),
    ]);
    await queryClient.invalidateQueries({
      queryKey: ["activity-key-manifest", activityId],
    });
  }

  async function checkTrackedTransaction() {
    try {
      await tracked.check();
      await refreshMembers();
      pushToast({ tone: "success", title: "链上状态已确认" });
    } catch (error) {
      showError(error, "暂时无法确认链上状态");
    }
  }

  function requireUnlocked(): boolean {
    if (unlocked) return true;
    pushToast({
      tone: "info",
      title: "请先在右上角解锁安全密码",
      description: "成员变更和代际授权必须由当前所有者解锁后执行。",
    });
    return false;
  }

  async function addMember() {
    if (
      !address ||
      !activity ||
      !publicClient ||
      !membersQuery.data ||
      busy ||
      !requireUnlocked()
    ) {
      return;
    }
    if (!isAddress(memberAddress)) {
      pushToast({ tone: "error", title: "请输入有效的 EVM 地址" });
      return;
    }
    const target = memberAddress as Address;
    if (target.toLowerCase() === activity.owner.toLowerCase()) {
      pushToast({
        tone: "error",
        title: "所有者无需添加",
        description: "活动所有者已经拥有完整上传和查看权限。",
      });
      return;
    }
    if (membersQuery.data.currentCount >= MAX_ACTIVITY_MEMBERS) {
      pushToast({
        tone: "error",
        title: "成员数量已满",
        description: `每个活动最多 ${MAX_ACTIVITY_MEMBERS} 人，所有者计入其中。`,
      });
      return;
    }

    try {
      await runWithPrivateKey(async (_privateKey, assertSessionCurrent) => {
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "add-member",
          resourceId: `${activityId}:${target.toLowerCase()}:${memberKind}`,
          preflight: async () => {
            assertSessionCurrent();
            const client = publicClient as unknown as PublicClient;
            const [removed, uploader, viewer, count] = await Promise.all([
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isRemovedMember",
                args: [id, target],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isUploader",
                args: [id, target],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isViewer",
                args: [id, target],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "getCurrentMemberCount",
                args: [id],
              }),
            ]);
            if (removed) throw new Error("该地址已被移除，不能再次加入");
            if (memberKind === "uploader" && uploader) return { satisfied: true };
            if (memberKind === "viewer" && viewer) return { satisfied: true };
            if (memberKind === "uploader" && viewer) {
              throw new Error("该地址当前是查看者，请使用“转为上传者”");
            }
            if (memberKind === "viewer" && uploader) {
              throw new Error("上传者不能降级为查看者");
            }
            if (Number(count) >= MAX_ACTIVITY_MEMBERS) {
              throw new Error(`每个活动最多 ${MAX_ACTIVITY_MEMBERS} 人`);
            }
            return { satisfied: false };
          },
          send: () => {
            assertSessionCurrent();
            return writeContractAsync({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName:
                memberKind === "uploader" ? "addUploader" : "addViewer",
              args: [id, target],
            });
          },
          verify: async () => {
            const client = publicClient as unknown as PublicClient;
            const active = await client.readContract({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName: memberKind === "uploader" ? "isUploader" : "isViewer",
              args: [id, target],
            });
            if (!active) throw new Error("交易已上链，但成员角色尚未生效");
            return target;
          },
        });
      });
      setMemberAddress("");
      await refreshMembers();
      pushToast({
        tone: "success",
        title: memberKind === "uploader" ? "上传者已添加" : "查看者已添加",
        description: "角色已生效；对方设置安全密码后，可授权缺失代际。",
      });
    } catch (error) {
      showError(error, "添加成员失败");
    }
  }

  async function removeMember(member: Address, kind: MemberKind) {
    if (
      !address ||
      !activity ||
      !publicClient ||
      busy ||
      !requireUnlocked()
    ) {
      return;
    }
    const roleName = kind === "uploader" ? "上传者" : "查看者";
    if (!window.confirm(`移除${roleName} ${shortAddress(member)}？该地址不能再次加入。`)) {
      return;
    }

    try {
      await runWithPrivateKey(async (_privateKey, assertSessionCurrent) => {
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "remove-member",
          resourceId: `${activityId}:${member.toLowerCase()}:remove`,
          preflight: async () => {
            assertSessionCurrent();
            const client = publicClient as unknown as PublicClient;
            const [removed, role] = await Promise.all([
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isRemovedMember",
                args: [id, member],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: kind === "uploader" ? "isUploader" : "isViewer",
                args: [id, member],
              }),
            ]);
            if (!role && removed) return { satisfied: true };
            if (!role) throw new Error(`该地址当前不是${roleName}`);
            return { satisfied: false };
          },
          send: () => {
            assertSessionCurrent();
            return writeContractAsync({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName:
                kind === "uploader" ? "removeUploader" : "removeViewer",
              args: [id, member],
            });
          },
          verify: async () => {
            const client = publicClient as unknown as PublicClient;
            const [role, removed] = await Promise.all([
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: kind === "uploader" ? "isUploader" : "isViewer",
                args: [id, member],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isRemovedMember",
                args: [id, member],
              }),
            ]);
            if (role || !removed) {
              throw new Error("交易已上链，但成员移除状态尚未生效");
            }
            return member;
          },
        });
      });
      await refreshMembers();
      pushToast({
        tone: "success",
        title: `${roleName}已移除`,
        description: "该地址不会获得新代际；如仍持有当前代际，请在右侧轮换。",
      });
    } catch (error) {
      showError(error, "移除成员失败");
    }
  }

  async function promoteMember(member: Address) {
    if (
      !address ||
      !activity ||
      !publicClient ||
      busy ||
      !requireUnlocked()
    ) {
      return;
    }
    try {
      await runWithPrivateKey(async (_privateKey, assertSessionCurrent) => {
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "promote-member",
          resourceId: `${activityId}:${member.toLowerCase()}:promote`,
          preflight: async () => {
            assertSessionCurrent();
            const client = publicClient as unknown as PublicClient;
            const [uploader, viewer] = await Promise.all([
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isUploader",
                args: [id, member],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isViewer",
                args: [id, member],
              }),
            ]);
            if (uploader && !viewer) return { satisfied: true };
            if (!viewer) throw new Error("只有当前查看者可以转为上传者");
            return { satisfied: false };
          },
          send: () => {
            assertSessionCurrent();
            return writeContractAsync({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName: "promoteViewerToUploader",
              args: [id, member],
            });
          },
          verify: async () => {
            const client = publicClient as unknown as PublicClient;
            const [uploader, viewer] = await Promise.all([
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isUploader",
                args: [id, member],
              }),
              client.readContract({
                address: requireRegistryAddress(),
                abi: ACTIVITY_PHOTO_REGISTRY_ABI,
                functionName: "isViewer",
                args: [id, member],
              }),
            ]);
            if (!uploader || viewer) {
              throw new Error("交易已上链，但角色升级状态尚未生效");
            }
            return member;
          },
        });
      });
      await refreshMembers();
      pushToast({
        tone: "success",
        title: "已转为上传者",
        description: "角色升级不可降级；缺失代际仍需单独授权。",
      });
    } catch (error) {
      showError(error, "角色升级失败");
    }
  }

  function openGrantDialog(member: Address, kind: MemberKind) {
    if (!activity || !manifestQuery.data || !requireUnlocked()) return;
    const memberKey = membersQuery.data?.publicKeys[member.toLowerCase()];
    if (!memberKey || memberKey === ZERO_KEY) {
      pushToast({
        tone: "error",
        title: "对方尚未设置安全密码",
        description: "请对方先设置安全密码，再授权缺失代际。",
      });
      return;
    }
    const grantedEpochs = listGrantedEpochs(
      manifestQuery.data,
      member,
      memberKey,
    );
    const missingEpochs = listMissingEpochs(activity.keyEpoch, grantedEpochs);
    setSelectedEpochs([]);
    setGrantTarget({
      address: member,
      kind,
      publicKey: memberKey,
      grantedEpochs,
      missingEpochs,
    });
  }

  async function grantSelectedEpochs() {
    if (
      !address ||
      !activity ||
      !unlocked ||
      !ownPublicKey ||
      !publicClient ||
      !grantTarget ||
      !selectedEpochs.length ||
      busy
    ) {
      return;
    }
    setSelectedEpochs([...selectedEpochs]);
    try {
      await runWithPrivateKey(async (privateKey, assertSessionCurrent) => {
        let manifest = await loadAndVerifyKeyManifest(activityId, activity);
        for (const epoch of selectedEpochs) {
          assertSessionCurrent();
          const activityKey = await decryptKeyForEpoch(
            manifest,
            address,
            epoch,
            privateKey,
          );
          try {
            manifest = await grantActivityKey(
              manifest,
              epoch,
              activityKey,
              grantTarget.address,
              grantTarget.publicKey,
            );
          } finally {
            activityKey.fill(0);
          }
        }
        assertSessionCurrent();
        const uploaded = await uploadKeyManifest(manifest);

        assertSessionCurrent();
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "grant-keys",
          resourceId: `${activityId}:${grantTarget.address.toLowerCase()}:${selectedEpochs.join(",")}`,
          context: {
            activityId,
            recipient: grantTarget.address,
            epochs: selectedEpochs.join(","),
          },
          preflight: async () => {
            assertSessionCurrent();
            const client = publicClient as unknown as PublicClient;
            const current = await readActivity(client, id);
            if (
              current.keyManifestTxId === uploaded.txId &&
              current.keyManifestHash === uploaded.manifestHash
            ) {
              return { satisfied: true };
            }
            if (
              current.keyManifestTxId !== activity.keyManifestTxId ||
              current.keyManifestHash !== activity.keyManifestHash
            ) {
              throw new Error("密钥清单已被更新，请刷新页面后重新选择代际");
            }
            const currentManifest = await loadAndVerifyKeyManifest(
              activityId,
              current,
            );
            const granted = listGrantedEpochs(
              currentManifest,
              grantTarget.address,
              grantTarget.publicKey,
            );
            if (selectedEpochs.every((epoch) => granted.includes(epoch))) {
              return { satisfied: true };
            }
            return { satisfied: false };
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
            const client = publicClient as unknown as PublicClient;
            const current = await readActivity(client, id);
            const currentManifest = await loadAndVerifyKeyManifest(
              activityId,
              current,
            );
            const granted = listGrantedEpochs(
              currentManifest,
              grantTarget.address,
              grantTarget.publicKey,
            );
            if (!selectedEpochs.every((epoch) => granted.includes(epoch))) {
              throw new Error("交易已上链，但所选代际授权尚未生效");
            }
            return currentManifest;
          },
        });
      });
      setGrantTarget(null);
      setSelectedEpochs([]);
      await refreshMembers();
      pushToast({
        tone: "success",
        title: "代际密钥已授权",
        description: `已追加第 ${formatEpochList(selectedEpochs)} 代。`,
      });
    } catch (error) {
      showError(error, "代际授权失败");
    }
  }

  async function rotateActivityKey() {
    if (
      !address ||
      !activity ||
      !publicClient ||
      !membersQuery.data ||
      !unlocked ||
      busy ||
      !isOwner
    ) {
      if (!unlocked) requireUnlocked();
      return;
    }
    if (
      !window.confirm(
        "轮换密钥会创建新的密钥代际，当前成员会自动获得新代际密钥，已移除成员不会获得。继续吗？",
      )
    ) {
      return;
    }

    const recipients = buildActiveRecipients(
      activity.owner,
      membersQuery.data.uploaders,
      membersQuery.data.viewers,
    );
    const missing = classifyMissingRecipientKeys(
      recipients,
      membersQuery.data.publicKeys,
    );
    if (
      missing.ownerMissing ||
      missing.uploadersMissing.length ||
      missing.viewersMissing.length
    ) {
      const descriptions = [
        missing.ownerMissing ? "所有者尚未设置安全密码" : "",
        missing.uploadersMissing.length
          ? `上传者未设置：${missing.uploadersMissing.map(shortAddress).join("、")}`
          : "",
        missing.viewersMissing.length
          ? `查看者未设置：${missing.viewersMissing.map(shortAddress).join("、")}`
          : "",
      ].filter(Boolean);
      pushToast({
        tone: "error",
        title: "无法轮换：有成员尚未设置安全密码",
        description: descriptions.join("；"),
      });
      return;
    }

    const nextActivityKeyHolder: { current: Uint8Array | null } = {
      current: null,
    };
    try {
      await runWithPrivateKey(async (_privateKey, assertSessionCurrent) => {
        const manifest = await loadAndVerifyKeyManifest(activityId, activity);
        const previousEpoch = activity.keyEpoch;
        const nextEpoch = previousEpoch + 1;
        nextActivityKeyHolder.current = generateActivityKey();
        let nextManifest: KeyManifest = {
          ...manifest,
          activeEpoch: nextEpoch,
          updatedAt: new Date().toISOString(),
        };

        for (const member of recipients.all) {
          assertSessionCurrent();
          nextManifest = await grantActivityKey(
            nextManifest,
            nextEpoch,
            nextActivityKeyHolder.current,
            member,
            membersQuery.data.publicKeys[member.toLowerCase()],
          );
        }

        assertSessionCurrent();
        const uploaded = await uploadKeyManifest(nextManifest);
        assertSessionCurrent();
        await tracked.execute({
          publicClient: publicClient as unknown as PublicClient,
          chainId,
          account: address,
          action: "rotate-keys",
          resourceId: `${activityId}:${previousEpoch}`,
          context: {
            activityId,
            previousEpoch,
            nextEpoch,
          },
          preflight: async () => {
            assertSessionCurrent();
            const current = await readActivity(
              publicClient as unknown as PublicClient,
              id,
            );
            if (current.keyEpoch > previousEpoch) {
              return { satisfied: true, result: current };
            }
            if (current.keyEpoch < previousEpoch) {
              throw new Error("链上密钥代际低于当前页面状态，请刷新");
            }
            return { satisfied: false };
          },
          send: () => {
            assertSessionCurrent();
            return writeContractAsync({
              address: requireRegistryAddress(),
              abi: ACTIVITY_PHOTO_REGISTRY_ABI,
              functionName: "updateKeyManifest",
              args: [
                id,
                nextEpoch,
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
              current.keyEpoch < nextEpoch ||
              current.keyManifestHash === ZERO_KEY
            ) {
              throw new Error("交易已上链，但新密钥代际尚未生效");
            }
            return current;
          },
        });
        await refreshMembers();
        pushToast({
          tone: "success",
          title: `密钥已轮换到第 ${nextEpoch} 代`,
          description: "后续照片将使用新活动密钥。",
        });
      });
    } catch (error) {
      showError(error, "密钥轮换失败");
    } finally {
      nextActivityKeyHolder.current?.fill(0);
      nextActivityKeyHolder.current = null;
    }
  }

  if (!isConnected) {
    return (
      <div className="setup-panel">
        <h2>连接钱包后管理成员</h2>
        <p>成员权限与活动所有权都绑定到钱包地址。</p>
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <div className="setup-panel">
        <ShieldAlert size={28} />
        <h2>请切换到 {TARGET_CHAIN.name}</h2>
        <p>切换网络后才能读取活动角色和密钥状态。</p>
      </div>
    );
  }

  if (activityQuery.isLoading) {
    return (
      <div className="loading-panel">
        <LoaderCircle className="spin" size={22} />
        正在读取成员
      </div>
    );
  }

  if (!activity) {
    const decoded = decodeContractError(
      activityQuery.error,
      ACTIVITY_PHOTO_REGISTRY_ABI,
    );
    const notFound = decoded?.errorName === "ActivityNotFound";
    return (
      <div className="setup-panel setup-panel-error">
        <h2>{notFound ? "活动不存在或本地链已重置" : "暂时无法读取成员"}</h2>
        <p>
          {notFound
            ? `链上未找到活动 #${activityId}。`
            : "请检查钱包网络后重试。"}
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

  if (!isOwner) {
    return (
      <div className="setup-panel">
        <p className="eyebrow">OWNER ONLY</p>
        <h2>只有活动所有者可以管理成员</h2>
        <p>当前钱包没有这个活动的管理权限。</p>
        <Link className="button button-secondary" href={`/activities/${activityId}`}>
          <ArrowLeft size={16} />
          返回活动
        </Link>
      </div>
    );
  }

  const uploaders = membersQuery.data?.uploaders ?? [];
  const viewers = membersQuery.data?.viewers ?? [];
  const currentAddresses = new Set(
    [...uploaders, ...viewers].map((member) => member.toLowerCase()),
  );
  const members: MemberRow[] = [
    ...uploaders.map((member) => ({
      address: member,
      kind: "uploader" as const,
    })),
    ...viewers
      .filter(
        (viewer) =>
          !uploaders.some(
            (uploader) => uploader.toLowerCase() === viewer.toLowerCase(),
          ),
      )
      .map((member) => ({
        address: member,
        kind: "viewer" as const,
      })),
  ];
  const removedMembers = (membersQuery.data?.removedAddresses ?? []).filter(
    (member) =>
      member.toLowerCase() !== activity.owner.toLowerCase() &&
      !currentAddresses.has(member.toLowerCase()),
  );
  const manifest = manifestQuery.data;
  const ownerEpochs = Array.from(
    { length: activity.keyEpoch },
    (_, index) => index + 1,
  );
  const currentCount = membersQuery.data?.currentCount ?? 1 + members.length;
  const canAdd = currentCount < MAX_ACTIVITY_MEMBERS;

  return (
    <div>
      <Link className="back-link" href={`/activities/${activityId}`}>
        <ArrowLeft size={15} />
        返回 {activity.name}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            MEMBERS & KEYS / #{activityId.padStart(3, "0")}
          </p>
          <h1>成员与密钥</h1>
          <p>链上角色负责操作权限，安全密码负责解密密钥授权。两者必须同时满足。</p>
        </div>
      </div>

      {manifestMissing ? (
        <div className="callout callout-danger section-gap">
          <ShieldAlert size={18} />
          <p>活动密钥清单尚未初始化。请先在活动时间线页完成初始化。</p>
        </div>
      ) : null}

      {membersQuery.isError ? (
        <div className="callout callout-danger section-gap">
          <ShieldAlert size={18} />
          <div>
            <p>成员、安全密码或历史移除记录读取失败。</p>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => membersQuery.refetch()}
            >
              重新读取
            </button>
          </div>
        </div>
      ) : null}

      {manifestQuery.isError ? (
        <div className="callout callout-danger section-gap">
          <ShieldAlert size={18} />
          <div>
            <p>密钥清单读取失败，当前不会显示授权入口。</p>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => manifestQuery.refetch()}
            >
              重新读取
            </button>
          </div>
        </div>
      ) : null}

      <TransactionStatusNotice
        state={tracked.state}
        onCheck={() => void checkTrackedTransaction()}
      />

      <div className="members-layout">
        <div className="members-main">
          <section className="member-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">INVITE</p>
                <h2>添加成员</h2>
              </div>
              <span>
                {currentCount}/{MAX_ACTIVITY_MEMBERS} 人
              </span>
            </div>
            <div className="member-add-form">
              <label className="field">
                <span>EVM 钱包地址</span>
                <input
                  className="text-input"
                  value={memberAddress}
                  onChange={(event) => setMemberAddress(event.target.value)}
                  placeholder="0x..."
                  disabled={!canAdd || busy}
                />
              </label>
              <label className="field">
                <span>成员类型</span>
                <select
                  value={memberKind}
                  onChange={(event) =>
                    setMemberKind(event.target.value as MemberKind)
                  }
                  disabled={!canAdd || busy}
                >
                  <option value="viewer">查看者</option>
                  <option value="uploader">上传者</option>
                </select>
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={busy || !canAdd}
                onClick={addMember}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                添加
              </button>
            </div>
            <p className="field-hint">
              {canAdd
                ? "所有者计入 20 人上限；已移除地址不占名额且不能再次加入。上传者天然拥有查看权限。"
                : "当前活动已有 20 个有效地址，不能继续添加新成员。"}
            </p>
          </section>

          <section className="member-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">ACCESS LIST</p>
                <h2>当前成员</h2>
              </div>
              <span>{currentCount}/{MAX_ACTIVITY_MEMBERS}</span>
            </div>

            <div className="owner-row">
              <span className="member-avatar">O</span>
              <div className="member-info">
                <strong>{shortAddress(activity.owner)}</strong>
                <p>活动所有者</p>
              </div>
              <div className="member-access">
                <span>可查看代际</span>
                <strong>全部（{formatEpochList(ownerEpochs)}）</strong>
              </div>
              <span className="badge badge-green">管理员</span>
            </div>

            <div className="member-list">
              {members.map((member) => {
                const memberKey =
                  membersQuery.data?.publicKeys[member.address.toLowerCase()];
                const hasAccountEncryption = Boolean(
                  memberKey && memberKey !== ZERO_KEY,
                );
                const grantedEpochs =
                  manifest && memberKey && memberKey !== ZERO_KEY
                    ? listGrantedEpochs(manifest, member.address, memberKey)
                    : [];
                const missingEpochs = manifest
                  ? listMissingEpochs(activity.keyEpoch, grantedEpochs)
                  : [];
                const canGrant =
                  Boolean(manifest) &&
                  hasAccountEncryption &&
                  missingEpochs.length > 0;

                return (
                  <div
                    className="member-row"
                    key={`${member.kind}-${member.address}`}
                  >
                    <span className="member-avatar">
                      {member.kind === "uploader" ? "U" : "V"}
                    </span>
                    <div className="member-info">
                      <strong>{shortAddress(member.address)}</strong>
                      <p>
                        {member.kind === "uploader"
                          ? "上传者 · 含查看权限"
                          : "查看者"}
                      </p>
                    </div>
                    <div className="member-access">
                      <span>可查看代际</span>
                      <strong>
                        {!hasAccountEncryption
                          ? "尚未设置安全密码"
                          : manifestQuery.isLoading
                            ? "读取中"
                            : !manifest
                              ? "读取失败"
                              : grantedEpochs.length
                                ? formatEpochList(grantedEpochs)
                                : "尚未授权"}
                      </strong>
                    </div>
                    <div className="member-actions">
                      {member.kind === "viewer" ? (
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          disabled={busy}
                          onClick={() => void promoteMember(member.address)}
                        >
                          <ArrowUpCircle size={14} />
                          转为上传者
                        </button>
                      ) : null}
                      {canGrant ? (
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            openGrantDialog(member.address, member.kind)
                          }
                        >
                          <KeyRound size={14} />
                          授权代际
                        </button>
                      ) : null}
                      <button
                        className="button button-danger button-small"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void removeMember(member.address, member.kind)
                        }
                      >
                        <Trash2 size={14} />
                        移除
                      </button>
                    </div>
                  </div>
                );
              })}
              {!members.length ? (
                <div className="member-empty">
                  <Users size={21} />
                  <p>除所有者外还没有成员。</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="member-section removed-members-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">REMOVED ADDRESSES</p>
                <h2>已移除成员</h2>
              </div>
              <span>{removedMembers.length}</span>
            </div>
            <div className="removed-member-list">
              {removedMembers.map((member) => {
                const memberKey =
                  membersQuery.data?.publicKeys[member.toLowerCase()];
                const hasAccountEncryption = Boolean(
                  memberKey && memberKey !== ZERO_KEY,
                );
                const epochs =
                  manifest && memberKey && memberKey !== ZERO_KEY
                    ? listGrantedEpochs(manifest, member, memberKey)
                    : [];
                const holdsCurrent = epochs.includes(activity.keyEpoch);
                return (
                  <div className="removed-member-row" key={member}>
                    <div>
                      <strong>{shortAddress(member)}</strong>
                      <p>
                        可解密代际：
                        {epochs.length ? formatEpochList(epochs) : "无可解密代际"}
                      </p>
                    </div>
                    {holdsCurrent ? (
                      <div className="removed-member-warning">
                        <ShieldAlert size={15} />
                        <span>
                          该地址仍持有当前代际密钥，可解密此代际照片；建议轮换活动密钥。
                        </span>
                      </div>
                    ) : (
                      <span className="badge">永久移除</span>
                    )}
                  </div>
                );
              })}
              {!removedMembers.length ? (
                <div className="member-empty">
                  <Users size={21} />
                  <p>没有被移除的成员。</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="members-aside">
          <div className="key-state-card">
            <p className="eyebrow">ACTIVITY KEY</p>
            <h2>第 {activity.keyEpoch} 代</h2>
            <p>
              当前有效成员 {currentCount} 人。轮换会为 owner、上传者和查看者生成新代际授权。
            </p>
            <dl>
              <div>
                <dt>清单状态</dt>
                <dd>{manifestMissing ? "未初始化" : "已发布"}</dd>
              </div>
              <div>
                <dt>有效成员</dt>
                <dd>{currentCount}/{MAX_ACTIVITY_MEMBERS}</dd>
              </div>
              <div>
                <dt>安全密码</dt>
                <dd>
                  {accountEncryptionStatus === "registered"
                    ? "已设置"
                    : accountEncryptionStatus === "unregistered"
                      ? "尚未设置"
                      : accountEncryptionStatus === "checking"
                        ? "确认中"
                        : "状态异常"}
                </dd>
              </div>
            </dl>
            <button
              className="button button-primary"
              type="button"
              disabled={busy || manifestMissing || !unlocked}
              onClick={rotateActivityKey}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <RefreshCw size={16} />
              )}
              轮换活动密钥
            </button>
            {!unlocked ? (
              <p className="field-hint">请先在右上角解锁安全密码。</p>
            ) : null}
          </div>

          <div className="callout callout-neutral">
            <ShieldCheck size={18} />
            <p>
              被移除成员可能仍持有旧代际密钥。轮换只保护新代际照片，不能撤回已经解密的数据。
            </p>
          </div>
        </aside>
      </div>

      {grantTarget ? (
        <GrantEpochDialog
          target={grantTarget}
          currentEpoch={activity.keyEpoch}
          selectedEpochs={selectedEpochs}
          busy={busy}
          onToggle={(epoch) =>
            setSelectedEpochs((current) =>
              current.includes(epoch)
                ? current.filter((candidate) => candidate !== epoch)
                : [...current, epoch].sort((left, right) => left - right),
            )
          }
          onSelectAll={() => setSelectedEpochs([...grantTarget.missingEpochs])}
          onClose={() => {
            if (busy) return;
            setGrantTarget(null);
            setSelectedEpochs([]);
          }}
          onConfirm={grantSelectedEpochs}
        />
      ) : null}
    </div>
  );
}
