"use client";

import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Wallet,
} from "lucide-react";
import type { TrackedTransactionState } from "@/lib/transaction-tracking";
import { shortHash } from "@/lib/format";

export function TransactionStatusNotice({
  state,
  onCheck,
}: {
  state: TrackedTransactionState;
  onCheck?: () => void;
}) {
  if (state.status === "idle") return null;

  const busy = [
    "preflight",
    "awaiting_wallet",
    "pending",
    "checking",
    "business_verifying",
  ].includes(state.status);
  const success = state.status === "success";
  const rejected = state.status === "rejected";
  const failed = state.status === "failed" || state.status === "unknown";

  return (
    <div
      className={
        success
          ? "transaction-notice transaction-notice-success"
          : rejected || failed
            ? "transaction-notice transaction-notice-error"
            : "transaction-notice"
      }
      role="status"
    >
      {busy ? (
        state.status === "awaiting_wallet" ? (
          <Wallet size={18} />
        ) : (
          <LoaderCircle className="spin" size={18} />
        )
      ) : success ? (
        <CircleCheck size={18} />
      ) : (
        <CircleAlert size={18} />
      )}
      <div>
        <strong>{state.message ?? state.status}</strong>
        {state.transactionHash ? (
          <small>交易 {shortHash(state.transactionHash)}</small>
        ) : null}
        {state.status === "unknown" ? (
          <small>不会自动重发，也不会自动产生 Gas。</small>
        ) : null}
      </div>
      {onCheck &&
      (state.status === "unknown" || state.status === "failed") &&
      state.transactionHash ? (
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={onCheck}
        >
          <RefreshCw size={14} />
          重新检查链上状态
        </button>
      ) : null}
    </div>
  );
}
