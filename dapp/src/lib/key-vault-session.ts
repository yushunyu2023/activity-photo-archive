export type UnlockSession = {
  scope: string;
  generation: number;
  idleDeadline: number;
};

export type UnlockSessionInvalidReason =
  | "locked"
  | "scope_changed"
  | "superseded"
  | "expired";

export class KeyVaultSessionError extends Error {
  readonly reason: UnlockSessionInvalidReason;

  constructor(reason: UnlockSessionInvalidReason) {
    super(
      reason === "expired"
        ? "安全密码已过期，请先在右上角重新解锁"
        : "安全密码会话已失效，请先在右上角重新解锁",
    );
    this.name = "KeyVaultSessionError";
    this.reason = reason;
  }
}

export function getUnlockSessionInvalidReason({
  session,
  currentScope,
  now,
  expectedGeneration,
}: {
  session: UnlockSession | null;
  currentScope: string | null;
  now: number;
  expectedGeneration?: number;
}): UnlockSessionInvalidReason | null {
  if (!session || !currentScope) return "locked";
  if (session.scope !== currentScope) return "scope_changed";
  if (
    expectedGeneration !== undefined &&
    session.generation !== expectedGeneration
  ) {
    return "superseded";
  }
  if (now >= session.idleDeadline) return "expired";
  return null;
}

export function isKeyVaultSessionError(
  error: unknown,
): error is KeyVaultSessionError {
  return error instanceof KeyVaultSessionError;
}
