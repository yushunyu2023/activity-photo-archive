import { expect, test } from "@playwright/test";
import {
  getUnlockSessionInvalidReason,
  KeyVaultSessionError,
} from "../src/lib/key-vault-session";

const session = {
  scope: "31337:0xabc",
  generation: 4,
  idleDeadline: 1_000,
};

test("unlock session rejects missing, foreign, superseded, and expired sessions", () => {
  expect(
    getUnlockSessionInvalidReason({
      session: null,
      currentScope: session.scope,
      now: 999,
    }),
  ).toBe("locked");

  expect(
    getUnlockSessionInvalidReason({
      session,
      currentScope: "31337:0xdef",
      now: 999,
    }),
  ).toBe("scope_changed");

  expect(
    getUnlockSessionInvalidReason({
      session,
      currentScope: session.scope,
      now: 999,
      expectedGeneration: session.generation - 1,
    }),
  ).toBe("superseded");

  expect(
    getUnlockSessionInvalidReason({
      session,
      currentScope: session.scope,
      now: session.idleDeadline,
      expectedGeneration: session.generation,
    }),
  ).toBe("expired");

  expect(
    getUnlockSessionInvalidReason({
      session,
      currentScope: session.scope,
      now: session.idleDeadline - 1,
      expectedGeneration: session.generation,
    }),
  ).toBeNull();
});

test("session failures use the same user-facing unlock guidance without exposing key data", () => {
  const expired = new KeyVaultSessionError("expired");
  const superseded = new KeyVaultSessionError("superseded");

  expect(expired.message).toContain("重新解锁");
  expect(superseded.message).toContain("重新解锁");
  expect(expired.message).not.toMatch(/0x[0-9a-f]{64}/i);
  expect(superseded.message).not.toMatch(/0x[0-9a-f]{64}/i);
});
