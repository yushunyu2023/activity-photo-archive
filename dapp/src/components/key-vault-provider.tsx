"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import type { Address, Hex } from "viem";
import { useToast } from "@/components/toast-provider";
import {
  ACCOUNT_ENCRYPTION_SCHEMA_VERSION,
  ACCOUNT_KDF_VERSION,
  deriveAccountEncryptionIdentity,
  generateAccountEncryptionSalt,
  isAccountEncryptionRecord,
  wipeBytes,
} from "@/lib/crypto";
import {
  ACTIVITY_PHOTO_REGISTRY_ABI,
  REGISTRY_ADDRESS,
  requireRegistryAddress,
} from "@/lib/contract";
import {
  classifyAccountEncryptionRecord,
  resolveAccountEncryptionStatus,
  type AccountEncryptionStatus,
} from "@/lib/account-encryption-state";
import {
  getUnlockSessionInvalidReason,
  KeyVaultSessionError,
  type UnlockSession,
} from "@/lib/key-vault-session";
import type {
  AccountEncryptionIdentity,
  AccountEncryptionRecord,
} from "@/lib/types";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";

const AUTO_LOCK_IDLE_MS = 5 * 60 * 1000;
const PENDING_SETUP_PREFIX = "activity-photo-account-encryption-pending-v2";

type PendingSetup = {
  schemaVersion: 2;
  publicKey: Hex;
  kdfSalt: Hex;
  kdfVersion: number;
  encryptionSchemaVersion: number;
};

function pendingSetupKey(chainId: number, address: Address): string {
  return `${PENDING_SETUP_PREFIX}:${chainId}:${address.toLowerCase()}`;
}

function readPendingSetup(
  chainId: number,
  address: Address,
): PendingSetup | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pendingSetupKey(chainId, address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSetup>;
    if (
      parsed.schemaVersion !== 2 ||
      !/^0x[0-9a-fA-F]{64}$/.test(parsed.publicKey ?? "") ||
      !/^0x[0-9a-fA-F]{32}$/.test(parsed.kdfSalt ?? "") ||
      parsed.kdfVersion !== ACCOUNT_KDF_VERSION ||
      parsed.encryptionSchemaVersion !== ACCOUNT_ENCRYPTION_SCHEMA_VERSION
    ) {
      window.localStorage.removeItem(pendingSetupKey(chainId, address));
      return null;
    }
    return parsed as PendingSetup;
  } catch {
    return null;
  }
}

function writePendingSetup(chainId: number, address: Address, value: PendingSetup) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    pendingSetupKey(chainId, address),
    JSON.stringify(value),
  );
}

function clearPendingSetup(chainId: number, address: Address) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingSetupKey(chainId, address));
}

type KeyVaultContextValue = {
  accountEncryption: AccountEncryptionRecord | null;
  accountEncryptionStatus: AccountEncryptionStatus;
  publicKey: Hex | null;
  ready: boolean;
  unlocked: boolean;
  sessionGeneration: number;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  prepareAccountEncryption: (password: string) => Promise<PendingSetup>;
  completeAccountEncryptionRegistration: (
    record: AccountEncryptionRecord,
  ) => void;
  discardPendingAccountEncryptionSetup: () => void;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  runWithPrivateKey: <T>(
    operation: (
      privateKey: Uint8Array,
      assertSessionCurrent: () => void,
    ) => Promise<T>,
  ) => Promise<T>;
  refetchAccountEncryption: () => Promise<unknown>;
  clearPendingSetup: () => void;
};

const KeyVaultContext = createContext<KeyVaultContextValue | null>(null);

export function KeyVaultProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { pushToast } = useToast();
  const [localRecord, setLocalRecord] =
    useState<AccountEncryptionRecord | null>(null);
  const [localRecordScope, setLocalRecordScope] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [autoPromptedScope, setAutoPromptedScope] = useState<string | null>(null);
  const [activeSessionView, setActiveSessionView] = useState<{
    scope: string;
    generation: number;
  } | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoLockCheckRef = useRef<() => void>(() => undefined);
  const privateKeyRef = useRef<Uint8Array | null>(null);
  const sessionRef = useRef<UnlockSession | null>(null);
  const sessionGenerationRef = useRef(0);
  const unlockRequestRef = useRef(0);
  const registeredRecordCacheRef = useRef(
    new Map<string, AccountEncryptionRecord>(),
  );

  const targetScope =
    address && chainId === TARGET_CHAIN_ID
      ? `${chainId}:${address.toLowerCase()}`
      : null;
  const targetScopeRef = useRef<string | null>(targetScope);
  targetScopeRef.current = targetScope;

  const {
    data: chainRecordData,
    isPending: accountEncryptionLoading,
    isSuccess: accountEncryptionLoaded,
    isError: accountEncryptionError,
    refetch: refetchAccountEncryptionQuery,
  } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getAccountEncryption",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(
        address &&
          REGISTRY_ADDRESS &&
          chainId === TARGET_CHAIN_ID,
      ),
      gcTime: 0,
    },
  });

  const chainRecordState = classifyAccountEncryptionRecord(chainRecordData);
  const chainRecord =
    isAccountEncryptionRecord(chainRecordData) ? chainRecordData : null;
  const localRecordMatchesScope =
    Boolean(localRecord) && localRecordScope === targetScope;
  const registryScope =
    targetScope && REGISTRY_ADDRESS
      ? `${targetScope}:${REGISTRY_ADDRESS.toLowerCase()}`
      : null;
  const cachedRegisteredRecord = registryScope
    ? registeredRecordCacheRef.current.get(registryScope) ?? null
    : null;
  const scopedRegisteredRecord = localRecordMatchesScope
    ? localRecord
    : cachedRegisteredRecord;
  const accountEncryptionStatus = resolveAccountEncryptionStatus({
    isConnected,
    chainMatches: chainId === TARGET_CHAIN_ID,
    registryConfigured: Boolean(REGISTRY_ADDRESS),
    loading: accountEncryptionLoading,
    success: accountEncryptionLoaded,
    error: accountEncryptionError,
    localRegistered: Boolean(scopedRegisteredRecord),
    recordState: chainRecordState,
  });
  const accountEncryption =
    scopedRegisteredRecord
      ? scopedRegisteredRecord
      : accountEncryptionStatus === "registered"
        ? chainRecord
        : null;

  useEffect(() => {
    if (!registryScope || !accountEncryptionLoaded || accountEncryptionError) {
      return;
    }
    if (chainRecord) {
      registeredRecordCacheRef.current.set(registryScope, chainRecord);
    }
  }, [
    accountEncryptionError,
    accountEncryptionLoaded,
    chainRecord,
    registryScope,
  ]);

  const clearLockTimer = useCallback(() => {
    if (lockTimer.current) {
      clearTimeout(lockTimer.current);
      lockTimer.current = null;
    }
  }, []);

  const lock = useCallback(() => {
    clearLockTimer();
    unlockRequestRef.current += 1;
    sessionRef.current = null;
    sessionGenerationRef.current += 1;
    const current = privateKeyRef.current;
    privateKeyRef.current = null;
    wipeBytes(current);
    setActiveSessionView(null);
    setSessionGeneration(sessionGenerationRef.current);
  }, [clearLockTimer]);

  const checkAutoLock = useCallback(() => {
    lockTimer.current = null;
    const session = sessionRef.current;
    if (!privateKeyRef.current || !session) return;
    const now = performance.now();
    const invalidReason = getUnlockSessionInvalidReason({
      session,
      currentScope: targetScopeRef.current,
      now,
    });
    if (!invalidReason) {
      const remaining = Math.max(0, session.idleDeadline - now);
      lockTimer.current = setTimeout(
        () => autoLockCheckRef.current(),
        remaining + 10,
      );
      return;
    }

    lock();
    if (invalidReason !== "expired") return;
    pushToast({
      tone: "info",
      title: "安全密码已自动锁定",
      description: "连续 5 分钟无页面内操作，请从右上角重新解锁。",
    });
  }, [lock, pushToast]);
  autoLockCheckRef.current = checkAutoLock;

  const scheduleLockCheck = useCallback(() => {
    const session = sessionRef.current;
    if (lockTimer.current || !privateKeyRef.current || !session) {
      return;
    }
    const now = performance.now();
    const invalidReason = getUnlockSessionInvalidReason({
      session,
      currentScope: targetScopeRef.current,
      now,
    });
    if (invalidReason) {
      autoLockCheckRef.current();
      return;
    }
    const remaining = Math.max(0, session.idleDeadline - now);
    if (remaining > 0) {
      lockTimer.current = setTimeout(
        () => autoLockCheckRef.current(),
        remaining + 10,
      );
      return;
    }
    autoLockCheckRef.current();
  }, []);

  const startSession = useCallback(
    (
      identity: AccountEncryptionIdentity,
      expectedScope: string,
      requestId: number,
    ) => {
      if (
        targetScopeRef.current !== expectedScope ||
        unlockRequestRef.current !== requestId
      ) {
        wipeBytes(identity.privateKey);
        throw new KeyVaultSessionError("superseded");
      }
      clearLockTimer();
      const previous = privateKeyRef.current;
      wipeBytes(previous);
      sessionGenerationRef.current += 1;
      const session: UnlockSession = {
        scope: expectedScope,
        generation: sessionGenerationRef.current,
        idleDeadline: performance.now() + AUTO_LOCK_IDLE_MS,
      };
      privateKeyRef.current = identity.privateKey;
      sessionRef.current = session;
      setActiveSessionView({
        scope: session.scope,
        generation: session.generation,
      });
      setSessionGeneration(session.generation);
      scheduleLockCheck();
    },
    [clearLockTimer, scheduleLockCheck],
  );

  useEffect(() => {
    lock();
    setLocalRecord(null);
    setLocalRecordScope(null);
    setDialogOpen(false);
  }, [targetScope, lock]);

  const unlocked =
    activeSessionView !== null && activeSessionView.scope === targetScope;

  useEffect(() => {
    if (!unlocked) return;

    const recordActivity = (event: Event) => {
      const session = sessionRef.current;
      if (!event.isTrusted || !privateKeyRef.current || !session) return;
      sessionRef.current = {
        ...session,
        idleDeadline: performance.now() + AUTO_LOCK_IDLE_MS,
      };
    };
    const checkDeadline = () => {
      const session = sessionRef.current;
      if (!privateKeyRef.current || !session) return;
      const invalidReason = getUnlockSessionInvalidReason({
        session,
        currentScope: targetScopeRef.current,
        now: performance.now(),
      });
      if (invalidReason) {
        autoLockCheckRef.current();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkDeadline();
    };

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity, { passive: true });
    window.addEventListener("touchstart", recordActivity, { passive: true });
    window.addEventListener("wheel", recordActivity, { passive: true });
    window.addEventListener("focus", checkDeadline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      window.removeEventListener("wheel", recordActivity);
      window.removeEventListener("focus", checkDeadline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearLockTimer();
    };
  }, [clearLockTimer, unlocked]);

  useEffect(() => {
    return () => {
      const current = privateKeyRef.current;
      privateKeyRef.current = null;
      sessionRef.current = null;
      unlockRequestRef.current += 1;
      sessionGenerationRef.current += 1;
      wipeBytes(current);
      clearLockTimer();
    };
  }, [clearLockTimer]);

  useEffect(() => {
    if (
      accountEncryptionStatus !== "unregistered" ||
      !targetScope ||
      autoPromptedScope === targetScope
    ) {
      return;
    }
    setAutoPromptedScope(targetScope);
    setDialogOpen(true);
  }, [
    accountEncryptionStatus,
    autoPromptedScope,
    targetScope,
  ]);

  const prepareAccountEncryption = useCallback(
    async (password: string): Promise<PendingSetup> => {
      const expectedScope = targetScope;
      if (!address || chainId !== TARGET_CHAIN_ID || !expectedScope) {
        throw new Error("请先连接目标网络的钱包");
      }
      if (accountEncryptionStatus !== "unregistered") {
        throw new Error("请等待链上状态确认后再设置安全密码");
      }
      const requestId = ++unlockRequestRef.current;

      const registryAddress = requireRegistryAddress();
      const existing = readPendingSetup(chainId, address);
      const setup =
        existing ??
        {
          schemaVersion: 2 as const,
          publicKey: `0x${"0".repeat(64)}` as Hex,
          kdfSalt: generateAccountEncryptionSalt(),
          kdfVersion: ACCOUNT_KDF_VERSION,
          encryptionSchemaVersion: ACCOUNT_ENCRYPTION_SCHEMA_VERSION,
        };
      const identity = await deriveAccountEncryptionIdentity({
        password,
        kdfSalt: setup.kdfSalt,
        chainId,
        registryAddress,
        walletAddress: address,
        kdfVersion: setup.kdfVersion,
      });

      if (
        targetScopeRef.current !== expectedScope ||
        unlockRequestRef.current !== requestId
      ) {
        wipeBytes(identity.privateKey);
        throw new KeyVaultSessionError("superseded");
      }
      if (
        existing &&
        existing.publicKey.toLowerCase() !== identity.publicKey.toLowerCase()
      ) {
        wipeBytes(identity.privateKey);
        throw new Error("本次安全密码与待登记的身份不一致，请使用原来的安全密码继续");
      }

      const nextSetup: PendingSetup = {
        ...setup,
        publicKey: identity.publicKey,
      };
      writePendingSetup(chainId, address, nextSetup);
      startSession(identity, expectedScope, requestId);
      return nextSetup;
    },
    [
      accountEncryptionStatus,
      address,
      chainId,
      startSession,
      targetScope,
    ],
  );

  const unlock = useCallback(
    async (password: string) => {
      const expectedScope = targetScope;
      if (!address || chainId !== TARGET_CHAIN_ID || !expectedScope) {
        throw new Error("请先连接目标网络的钱包");
      }
      if (!accountEncryption) {
        throw new Error("当前地址尚未设置安全密码");
      }
      const requestId = ++unlockRequestRef.current;
      const identity = await deriveAccountEncryptionIdentity({
        password,
        kdfSalt: accountEncryption.kdfSalt,
        chainId,
        registryAddress: requireRegistryAddress(),
        walletAddress: address,
        kdfVersion: accountEncryption.kdfVersion,
      });
      if (
        targetScopeRef.current !== expectedScope ||
        unlockRequestRef.current !== requestId
      ) {
        wipeBytes(identity.privateKey);
        throw new KeyVaultSessionError("superseded");
      }
      if (
        identity.publicKey.toLowerCase() !==
        accountEncryption.publicKey.toLowerCase()
      ) {
        wipeBytes(identity.privateKey);
        throw new Error("安全密码不正确");
      }
      startSession(identity, expectedScope, requestId);
    },
    [accountEncryption, address, chainId, startSession, targetScope],
  );

  const runWithPrivateKey = useCallback(
    async <T,>(
      operation: (
        privateKey: Uint8Array,
        assertSessionCurrent: () => void,
      ) => Promise<T>,
    ): Promise<T> => {
      const session = sessionRef.current;
      const privateKey = privateKeyRef.current;
      const invalidReason = getUnlockSessionInvalidReason({
        session,
        currentScope: targetScopeRef.current,
        now: performance.now(),
      });
      if (!privateKey || invalidReason) {
        lock();
        throw new KeyVaultSessionError(invalidReason ?? "locked");
      }

      const expectedGeneration = session!.generation;
      const assertSessionCurrent = () => {
        const currentReason = getUnlockSessionInvalidReason({
          session: sessionRef.current,
          currentScope: targetScopeRef.current,
          now: performance.now(),
          expectedGeneration,
        });
        if (!privateKeyRef.current || currentReason) {
          lock();
          throw new KeyVaultSessionError(currentReason ?? "locked");
        }
      };

      try {
        const result = await operation(privateKey, assertSessionCurrent);
        assertSessionCurrent();
        return result;
      } catch (error) {
        const currentReason = getUnlockSessionInvalidReason({
          session: sessionRef.current,
          currentScope: targetScopeRef.current,
          now: performance.now(),
          expectedGeneration,
        });
        if (!privateKeyRef.current || currentReason) {
          lock();
          throw new KeyVaultSessionError(currentReason ?? "locked");
        }
        throw error;
      }
    },
    [lock],
  );

  const completeAccountEncryptionRegistration = useCallback(
    (record: AccountEncryptionRecord) => {
      if (!address || !targetScope) return;
      setLocalRecord(record);
      setLocalRecordScope(targetScope);
      if (targetScope && REGISTRY_ADDRESS) {
        registeredRecordCacheRef.current.set(
          `${targetScope}:${REGISTRY_ADDRESS.toLowerCase()}`,
          record,
        );
      }
      clearPendingSetup(chainId, address);
      lock();
    },
    [address, chainId, lock, targetScope],
  );

  const discardPendingAccountEncryptionSetup = useCallback(() => {
    if (address && chainId) clearPendingSetup(chainId, address);
    lock();
  }, [address, chainId, lock]);

  const clearPending = useCallback(() => {
    if (address && chainId) clearPendingSetup(chainId, address);
  }, [address, chainId]);

  const refetchAccountEncryption = useCallback(async () => {
    const result = await refetchAccountEncryptionQuery();
    return result.data;
  }, [refetchAccountEncryptionQuery]);

  const value = useMemo(
    () => ({
      accountEncryption,
      accountEncryptionStatus,
      publicKey: accountEncryption?.publicKey ?? null,
      ready: Boolean(
        accountEncryptionStatus === "unregistered" ||
          accountEncryptionStatus === "registered",
      ),
      unlocked,
      sessionGeneration,
      dialogOpen,
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
      prepareAccountEncryption,
      completeAccountEncryptionRegistration,
      discardPendingAccountEncryptionSetup,
      unlock,
      lock,
      runWithPrivateKey,
      refetchAccountEncryption,
      clearPendingSetup: clearPending,
    }),
    [
      accountEncryption,
      accountEncryptionStatus,
      accountEncryptionLoading,
      address,
      chainId,
      clearPending,
      completeAccountEncryptionRegistration,
      discardPendingAccountEncryptionSetup,
      dialogOpen,
      lock,
      prepareAccountEncryption,
      refetchAccountEncryption,
      runWithPrivateKey,
      sessionGeneration,
      unlock,
      unlocked,
    ],
  );

  return <KeyVaultContext.Provider value={value}>{children}</KeyVaultContext.Provider>;
}

export function useKeyVault(): KeyVaultContextValue {
  const context = useContext(KeyVaultContext);
  if (!context) throw new Error("useKeyVault must be used inside KeyVaultProvider");
  return context;
}
