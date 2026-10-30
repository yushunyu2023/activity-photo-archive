import { expect, test } from "@playwright/test";
import {
  classifyAccountEncryptionRecord,
  parseAccountEncryptionRecord,
  resolveAccountEncryptionStatus,
} from "../src/lib/account-encryption-state";

const registeredRecord = {
  publicKey: `0x${"11".repeat(32)}`,
  kdfSalt: `0x${"22".repeat(16)}`,
  kdfVersion: 1,
  schemaVersion: 1,
  exists: true,
};

const baseStatus = {
  isConnected: true,
  chainMatches: true,
  registryConfigured: true,
  loading: false,
  success: true,
  error: false,
  localRegistered: false,
};

test("account encryption records distinguish unregistered, registered, and incompatible results", () => {
  expect(
    classifyAccountEncryptionRecord({
      publicKey: `0x${"00".repeat(32)}`,
      kdfSalt: `0x${"00".repeat(16)}`,
      kdfVersion: 0,
      schemaVersion: 0,
      exists: false,
    }),
  ).toBe("unregistered");
  expect(classifyAccountEncryptionRecord(registeredRecord)).toBe("registered");
  expect(
    classifyAccountEncryptionRecord({
      ...registeredRecord,
      schemaVersion: 2,
    }),
  ).toBe("incompatible");
  expect(classifyAccountEncryptionRecord(null)).toBe("incompatible");

  expect(parseAccountEncryptionRecord(registeredRecord)).toEqual({
    kind: "registered",
    record: registeredRecord,
  });
  expect(parseAccountEncryptionRecord(undefined)).toEqual({
    kind: "incompatible",
  });
});

test("account state fails closed for disconnected, wrong-network, loading, and read errors", () => {
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      isConnected: false,
      recordState: "unregistered",
    }),
  ).toBe("disconnected");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      chainMatches: false,
      recordState: "unregistered",
    }),
  ).toBe("wrong_network");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      loading: true,
      recordState: "incompatible",
    }),
  ).toBe("checking");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      error: true,
      recordState: "unregistered",
    }),
  ).toBe("read_error");
});

test("only an explicit successful unregistered result opens first-time setup", () => {
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      recordState: "unregistered",
    }),
  ).toBe("unregistered");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      recordState: "registered",
    }),
  ).toBe("registered");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      recordState: "incompatible",
    }),
  ).toBe("incompatible");
  expect(
    resolveAccountEncryptionStatus({
      ...baseStatus,
      localRegistered: true,
      recordState: "incompatible",
    }),
  ).toBe("registered");
});
