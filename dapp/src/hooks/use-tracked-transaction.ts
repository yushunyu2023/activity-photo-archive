"use client";

import { useCallback, useRef, useState } from "react";
import {
  checkPendingTransaction,
  runTrackedTransaction,
  type TrackedTransactionOptions,
  type TrackedTransactionState,
} from "@/lib/transaction-tracking";

export function useTrackedTransaction() {
  const [state, setState] = useState<TrackedTransactionState>({
    status: "idle",
  });
  const lastOptions = useRef<TrackedTransactionOptions<unknown> | null>(null);

  const withStatus = useCallback(
    <T,>(options: TrackedTransactionOptions<T>): TrackedTransactionOptions<T> => ({
      ...options,
      onStatus: (nextState: TrackedTransactionState) => {
        setState(nextState);
        options.onStatus?.(nextState);
      },
    }),
    [],
  );

  const execute = useCallback(
    async <T,>(options: TrackedTransactionOptions<T>): Promise<T> => {
      const trackedOptions = withStatus(options) as TrackedTransactionOptions<unknown>;
      lastOptions.current = trackedOptions;
      return runTrackedTransaction(trackedOptions) as Promise<T>;
    },
    [withStatus],
  );

  const check = useCallback(
    async <T,>(options?: TrackedTransactionOptions<T>): Promise<T> => {
      const target =
        options ??
        (lastOptions.current as TrackedTransactionOptions<T> | null);
      if (!target) {
        throw new Error("当前页面没有可检查的交易上下文，请重新触发原操作");
      }
      const trackedOptions = withStatus(target) as TrackedTransactionOptions<unknown>;
      lastOptions.current = trackedOptions;
      return checkPendingTransaction(trackedOptions) as Promise<T>;
    },
    [withStatus],
  );

  const reset = useCallback(() => {
    lastOptions.current = null;
    setState({ status: "idle" });
  }, []);

  return {
    state,
    execute,
    check,
    reset,
    canCheck:
      Boolean(state.transactionHash) &&
      (state.status === "unknown" || state.status === "failed"),
  };
}
