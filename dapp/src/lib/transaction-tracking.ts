import type { Address, Hex, PublicClient, TransactionReceipt } from "viem";

export type TrackedTransactionAction =
  | "account-encryption"
  | "create-activity"
  | "add-member"
  | "remove-member"
  | "promote-member"
  | "initialize-keys"
  | "grant-keys"
  | "rotate-keys"
  | "publish-photo";

export type TrackedTransactionStatus =
  | "idle"
  | "preflight"
  | "awaiting_wallet"
  | "pending"
  | "checking"
  | "business_verifying"
  | "success"
  | "rejected"
  | "failed"
  | "unknown";

export type TrackedTransactionState = {
  status: TrackedTransactionStatus;
  action?: TrackedTransactionAction;
  resourceId?: string;
  transactionHash?: Hex;
  message?: string;
};

type StoredContext = Record<string, string | number | boolean>;

export type PendingTransaction = {
  schemaVersion: 2;
  chainId: number;
  account: Address;
  action: TrackedTransactionAction;
  resourceId: string;
  transactionHash: Hex;
  createdAt: string;
  context: StoredContext;
};

const STORAGE_PREFIX = "activity-photo-pending-transaction-v2";

export class TrackedTransactionError extends Error {
  readonly status: TrackedTransactionStatus;
  readonly transactionHash?: Hex;

  constructor(
    message: string,
    status: "rejected" | "failed" | "unknown",
    transactionHash?: Hex,
  ) {
    super(message);
    this.name = "TrackedTransactionError";
    this.status = status;
    this.transactionHash = transactionHash;
  }
}

function storageKey(
  chainId: number,
  account: Address,
  action: TrackedTransactionAction,
  resourceId: string,
) {
  return `${STORAGE_PREFIX}:${chainId}:${account.toLowerCase()}:${action}:${resourceId}`;
}

export function readPendingTransaction(
  chainId: number,
  account: Address,
  action: TrackedTransactionAction,
  resourceId: string,
): PendingTransaction | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(chainId, account, action, resourceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingTransaction>;
    if (
      parsed.schemaVersion !== 2 ||
      parsed.chainId !== chainId ||
      parsed.account?.toLowerCase() !== account.toLowerCase() ||
      parsed.action !== action ||
      parsed.resourceId !== resourceId ||
      typeof parsed.transactionHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(parsed.transactionHash)
    ) {
      window.localStorage.removeItem(storageKey(chainId, account, action, resourceId));
      return null;
    }
    return parsed as PendingTransaction;
  } catch {
    return null;
  }
}

export function savePendingTransaction(record: PendingTransaction): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey(record.chainId, record.account, record.action, record.resourceId),
    JSON.stringify(record),
  );
}

export function clearPendingTransaction(
  chainId: number,
  account: Address,
  action: TrackedTransactionAction,
  resourceId: string,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(chainId, account, action, resourceId));
}

async function readReceipt(
  publicClient: PublicClient,
  transactionHash: Hex,
): Promise<TransactionReceipt> {
  return publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 8_000,
    pollingInterval: 1_000,
  });
}

export type TrackedTransactionOptions<T> = {
  publicClient: PublicClient;
  chainId: number;
  account: Address;
  action: TrackedTransactionAction;
  resourceId: string;
  context?: StoredContext;
  preflight: () => Promise<{ satisfied: boolean; result?: T }>;
  send: () => Promise<Hex>;
  verify: (receipt: TransactionReceipt) => Promise<T>;
  onStatus?: (state: TrackedTransactionState) => void;
};

function updateState<T>(
  options: TrackedTransactionOptions<T>,
  state: TrackedTransactionState,
) {
  options.onStatus?.(state);
}

async function verifyReceipt<T>(
  options: TrackedTransactionOptions<T>,
  receipt: TransactionReceipt,
): Promise<T> {
  if (receipt.status !== "success") {
    throw new TrackedTransactionError(
      "交易已上链，但合约执行失败。",
      "failed",
      receipt.transactionHash,
    );
  }
  updateState(options, {
    status: "business_verifying",
    action: options.action,
    resourceId: options.resourceId,
    transactionHash: receipt.transactionHash,
    message: "交易已上链，正在回读业务状态",
  });
  return options.verify(receipt);
}

export async function runTrackedTransaction<T>(
  options: TrackedTransactionOptions<T>,
): Promise<T> {
  const pending = readPendingTransaction(
    options.chainId,
    options.account,
    options.action,
    options.resourceId,
  );

  if (pending) {
    updateState(options, {
      status: "checking",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash: pending.transactionHash,
      message: "发现待检查交易，正在只读核对链上状态",
    });
    let receipt: TransactionReceipt;
    try {
      receipt = await readReceipt(options.publicClient, pending.transactionHash);
    } catch (error) {
      const state = {
        status: "unknown" as const,
        action: options.action,
        resourceId: options.resourceId,
        transactionHash: pending.transactionHash,
        message: "上一笔交易仍在确认或 RPC 暂不可用",
      };
      updateState(options, state);
      throw new TrackedTransactionError(
        state.message,
        "unknown",
        pending.transactionHash,
      );
    }

    try {
      const result = await verifyReceipt(options, receipt);
      clearPendingTransaction(
        options.chainId,
        options.account,
        options.action,
        options.resourceId,
      );
      updateState(options, {
        status: "success",
        action: options.action,
        resourceId: options.resourceId,
        transactionHash: pending.transactionHash,
        message: "链上状态已确认",
      });
      return result;
    } catch (error) {
      if (receipt.status === "success") {
        updateState(options, {
          status: "unknown",
          action: options.action,
          resourceId: options.resourceId,
          transactionHash: pending.transactionHash,
          message: error instanceof Error ? error.message : "暂时无法确认业务状态",
        });
        throw new TrackedTransactionError(
          error instanceof Error ? error.message : "暂时无法确认业务状态",
          "unknown",
          pending.transactionHash,
        );
      }
      clearPendingTransaction(
        options.chainId,
        options.account,
        options.action,
        options.resourceId,
      );
      updateState(options, {
        status: "failed",
        action: options.action,
        resourceId: options.resourceId,
        transactionHash: pending.transactionHash,
        message: "上一笔交易已明确失败",
      });
      throw error;
    }
  }

  updateState(options, {
    status: "preflight",
    action: options.action,
    resourceId: options.resourceId,
    message: "正在执行只读预检",
  });

  let preflight: { satisfied: boolean; result?: T };
  try {
    preflight = await options.preflight();
  } catch (error) {
    const message = error instanceof Error ? error.message : "链上预检失败";
    updateState(options, {
      status: "unknown",
      action: options.action,
      resourceId: options.resourceId,
      message: `链上预检失败：${message}`,
    });
    throw new TrackedTransactionError(`链上预检失败：${message}`, "unknown");
  }

  if (preflight.satisfied) {
    updateState(options, {
      status: "success",
      action: options.action,
      resourceId: options.resourceId,
      message: "目标状态已经存在，本次未请求钱包",
    });
    return preflight.result as T;
  }

  updateState(options, {
    status: "awaiting_wallet",
    action: options.action,
    resourceId: options.resourceId,
    message: "等待钱包确认",
  });

  let transactionHash: Hex;
  try {
    transactionHash = await options.send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "钱包未返回交易哈希";
    const rejected = /user rejected|user denied|rejected the request|request rejected/i.test(message);
    updateState(options, {
      status: rejected ? "rejected" : "failed",
      action: options.action,
      resourceId: options.resourceId,
      message: rejected ? "你已在钱包中取消本次操作" : `交易发送失败：${message}`,
    });
    throw new TrackedTransactionError(
      message,
      rejected ? "rejected" : "failed",
    );
  }

  savePendingTransaction({
    schemaVersion: 2,
    chainId: options.chainId,
    account: options.account,
    action: options.action,
    resourceId: options.resourceId,
    transactionHash,
    createdAt: new Date().toISOString(),
    context: options.context ?? {},
  });
  updateState(options, {
    status: "pending",
    action: options.action,
    resourceId: options.resourceId,
    transactionHash,
    message: "交易已提交，正在等待链上回执",
  });

  let receipt: TransactionReceipt;
  try {
    receipt = await readReceipt(options.publicClient, transactionHash);
  } catch {
    updateState(options, {
      status: "unknown",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash,
      message: "暂时无法读取回执。交易可能仍在处理中",
    });
    throw new TrackedTransactionError(
      "暂时无法读取回执。交易可能仍在处理中",
      "unknown",
      transactionHash,
    );
  }

  try {
    const result = await verifyReceipt(options, receipt);
    clearPendingTransaction(
      options.chainId,
      options.account,
      options.action,
      options.resourceId,
    );
    updateState(options, {
      status: "success",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash,
      message: "链上状态已确认",
    });
    return result;
  } catch (error) {
    if (receipt.status === "success") {
      updateState(options, {
        status: "unknown",
        action: options.action,
        resourceId: options.resourceId,
        transactionHash,
        message: error instanceof Error ? error.message : "暂时无法确认业务状态",
      });
      throw new TrackedTransactionError(
        error instanceof Error ? error.message : "暂时无法确认业务状态",
        "unknown",
        transactionHash,
      );
    }
    clearPendingTransaction(
      options.chainId,
      options.account,
      options.action,
      options.resourceId,
    );
    updateState(options, {
      status: "failed",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash,
      message: "交易已明确失败",
    });
    throw error;
  }
}

export async function checkPendingTransaction<T>(
  options: TrackedTransactionOptions<T>,
): Promise<T> {
  const pending = readPendingTransaction(
    options.chainId,
    options.account,
    options.action,
    options.resourceId,
  );
  if (!pending) {
    throw new TrackedTransactionError("没有可检查的交易记录", "failed");
  }

  updateState(options, {
    status: "checking",
    action: options.action,
    resourceId: options.resourceId,
    transactionHash: pending.transactionHash,
    message: "正在只读检查链上状态",
  });
  let receipt: TransactionReceipt;
  try {
    receipt = await readReceipt(options.publicClient, pending.transactionHash);
  } catch {
    updateState(options, {
      status: "unknown",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash: pending.transactionHash,
      message: "交易仍在确认或 RPC 暂不可用",
    });
    throw new TrackedTransactionError(
      "交易仍在确认或 RPC 暂不可用",
      "unknown",
      pending.transactionHash,
    );
  }

  try {
    const result = await verifyReceipt(options, receipt);
    clearPendingTransaction(
      options.chainId,
      options.account,
      options.action,
      options.resourceId,
    );
    updateState(options, {
      status: "success",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash: pending.transactionHash,
      message: "链上状态已确认",
    });
    return result;
  } catch (error) {
    updateState(options, {
      status: "unknown",
      action: options.action,
      resourceId: options.resourceId,
      transactionHash: pending.transactionHash,
      message: error instanceof Error ? error.message : "暂时无法确认业务状态",
    });
    throw new TrackedTransactionError(
      error instanceof Error ? error.message : "暂时无法确认业务状态",
      "unknown",
      pending.transactionHash,
    );
  }
}
