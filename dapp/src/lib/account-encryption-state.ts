import { isAccountEncryptionRecord } from "./crypto";
import type { AccountEncryptionRecord } from "./types";

export type AccountEncryptionStatus =
  | "disconnected"
  | "wrong_network"
  | "checking"
  | "read_error"
  | "unregistered"
  | "registered"
  | "incompatible";

export type AccountEncryptionRecordState =
  | "unregistered"
  | "registered"
  | "incompatible";

export function classifyAccountEncryptionRecord(
  value: unknown,
): AccountEncryptionRecordState {
  if (!value || typeof value !== "object") return "incompatible";
  if ((value as { exists?: unknown }).exists === false) return "unregistered";
  return isAccountEncryptionRecord(value) ? "registered" : "incompatible";
}

export function resolveAccountEncryptionStatus({
  isConnected,
  chainMatches,
  registryConfigured,
  loading,
  success,
  error,
  localRegistered,
  recordState,
}: {
  isConnected: boolean;
  chainMatches: boolean;
  registryConfigured: boolean;
  loading: boolean;
  success: boolean;
  error: boolean;
  localRegistered: boolean;
  recordState: AccountEncryptionRecordState;
}): AccountEncryptionStatus {
  if (!isConnected) return "disconnected";
  if (!chainMatches) return "wrong_network";
  if (!registryConfigured) return "read_error";
  if (localRegistered) return "registered";
  if (loading) return "checking";
  if (error) return "read_error";
  if (!success) return "checking";
  if (recordState === "unregistered") return "unregistered";
  if (recordState === "registered") return "registered";
  return "incompatible";
}

export type AccountEncryptionRecordLookup =
  | { kind: "unregistered" }
  | { kind: "registered"; record: AccountEncryptionRecord }
  | { kind: "incompatible" };

export function parseAccountEncryptionRecord(
  value: unknown,
): AccountEncryptionRecordLookup {
  const state = classifyAccountEncryptionRecord(value);
  if (state === "unregistered") return { kind: "unregistered" };
  if (state === "registered") {
    return { kind: "registered", record: value as AccountEncryptionRecord };
  }
  return { kind: "incompatible" };
}
