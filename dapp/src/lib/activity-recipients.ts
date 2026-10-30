import type { Address, Hex } from "viem";

export type ActiveRecipients = {
  owner: Address;
  uploaderAccount: Address[];
  viewerAccounts: Address[];
  all: Address[];
};

export function buildActiveRecipients(
  owner: Address,
  uploaders: readonly Address[],
  viewers: readonly Address[],
): ActiveRecipients {
  const seen = new Set<string>();
  const all: Address[] = [];

  for (const account of [owner, ...uploaders, ...viewers]) {
    const normalized = account.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    all.push(account);
  }

  return {
    owner,
    uploaderAccount: [...uploaders],
    viewerAccounts: [...viewers],
    all,
  };
}

export function classifyMissingRecipientKeys(
  recipients: ActiveRecipients,
  publicKeys: Readonly<Record<string, Hex>>,
): {
  ownerMissing: boolean;
  uploadersMissing: Address[];
  viewersMissing: Address[];
} {
  const hasKey = (account: Address) => {
    const value = publicKeys[account.toLowerCase()];
    return Boolean(value && value !== `0x${"0".repeat(64)}`);
  };

  return {
    ownerMissing: !hasKey(recipients.owner),
    uploadersMissing: recipients.uploaderAccount.filter((account) => !hasKey(account)),
    viewersMissing: recipients.viewerAccounts.filter((account) => !hasKey(account)),
  };
}
