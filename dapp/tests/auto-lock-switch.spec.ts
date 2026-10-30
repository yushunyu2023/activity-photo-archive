import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, http, type Address } from "viem";
import {
  ANVIL_ACCOUNTS,
  ANVIL_RPC_URL,
  installAnvilWallet,
  switchAnvilAccount,
} from "./anvil-wallet";
import { ACTIVITY_PHOTO_REGISTRY_ABI } from "../src/lib/contract";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const CLOCK_START = new Date("2030-01-01T00:00:00.000Z");
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  "0x5FbDB2315678afecb367f032d93F642f64180aa3") as Address;

const publicClient = createPublicClient({
  transport: http(ANVIL_RPC_URL),
});

type WalletAccount = {
  index: number;
  password: string;
};

async function isAccountEncryptionRegistered(account: Address) {
  const record = (await publicClient.readContract({
    address: REGISTRY_ADDRESS,
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getAccountEncryption",
    args: [account],
  })) as { exists: boolean };
  return record.exists;
}

async function connectMetaMask(page: Page) {
  await page.getByRole("button", { name: "连接钱包" }).click();
  await page
    .locator(".wallet-option")
    .filter({ hasText: "MetaMask" })
    .click();
  await expect(page.locator(".wallet-account")).toBeVisible();
  await expect(page.locator(".network-pill")).toContainText("Anvil Local");
}

async function enableAndUnlockAccountEncryption(
  page: Page,
  password: string,
) {
  await expect(
    page.getByRole("heading", { name: "设置安全密码" }),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByPlaceholder("12 至 128 个字符，建议使用长密码或多个词语")
    .fill(password);
  await page.getByPlaceholder("再次输入").fill(password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "设置并登记安全密码" }).click();

  await expect(
    page.getByRole("heading", { name: "解锁安全密码" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("输入安全密码").fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");
}

async function unlockAccountEncryption(page: Page, password: string) {
  await expect(page.locator(".vault-status")).toContainText("解锁");
  await page.locator(".vault-status").click();
  await page.getByPlaceholder("输入安全密码").fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");
}

async function ensureAccountEncryption(
  page: Page,
  account: WalletAccount,
) {
  await expect(page.locator(".wallet-account")).toContainText(
    ANVIL_ACCOUNTS[account.index].slice(0, 6),
  );

  if (
    await isAccountEncryptionRegistered(
      ANVIL_ACCOUNTS[account.index] as Address,
    )
  ) {
    await page.waitForTimeout(250);
    if (
      !(await page.locator(".vault-status").textContent())?.includes(
        "安全密码已解锁",
      )
    ) {
      await unlockAccountEncryption(page, account.password);
    }
    return;
  }

  await enableAndUnlockAccountEncryption(page, account.password);
}

async function switchToAccount(page: Page, account: WalletAccount) {
  await switchAnvilAccount(page, account.index);
  await expect(page.locator(".wallet-account")).toContainText(
    ANVIL_ACCOUNTS[account.index].slice(0, 6),
  );
}

async function expectLocked(page: Page) {
  await expect(page.locator(".vault-status")).toHaveText("解锁安全密码");
}

async function expectUnlocked(page: Page) {
  await expect(page.locator(".vault-status")).toHaveText("安全密码已解锁");
}

async function openPageWithWallet(
  page: Page,
  account: WalletAccount,
) {
  await page.clock.install({ time: CLOCK_START });
  await installAnvilWallet(page, { initialAccountIndex: account.index });
  await page.goto("/");
  await connectMetaMask(page);
}

async function prepareRegisteredPair(
  page: Page,
  first: WalletAccount,
  second: WalletAccount,
) {
  await openPageWithWallet(page, first);
  await ensureAccountEncryption(page, first);
  await switchToAccount(page, second);
  await ensureAccountEncryption(page, second);
}

test("old timer from address A cannot affect a later session on address B", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const first = { index: 3, password: "Auto-Lock-Account-3-Passphrase-2026!" };
  const second = { index: 7, password: "Auto-Lock-Account-7-Passphrase-2026!" };

  await prepareRegisteredPair(page, first, second);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

  await switchToAccount(page, first);
  await unlockAccountEncryption(page, first.password);

  await switchToAccount(page, second);
  await page.clock.fastForward(60_000);
  await unlockAccountEncryption(page, second.password);

  // t=6:01 crosses address A's original deadline. Address B remains valid
  // until its own five-minute deadline.
  await page.clock.fastForward(4 * 60_000 + 1_000);
  await expectUnlocked(page);

  await page.clock.fastForward(60_000);
  await expectLocked(page);
});

test("switching near the old address deadline does not prematurely lock address B", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const first = { index: 8, password: "Auto-Lock-Account-8-Passphrase-2026!" };
  const second = { index: 9, password: "Auto-Lock-Account-9-Passphrase-2026!" };

  await prepareRegisteredPair(page, first, second);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

  await switchToAccount(page, first);
  await unlockAccountEncryption(page, first.password);
  await page.clock.fastForward(FIVE_MINUTES_MS - 1_000);

  await switchToAccount(page, second);
  await unlockAccountEncryption(page, second.password);

  // Cross address A's old deadline by two seconds. Address B must still be in
  // the first second of its own five-minute session.
  await page.clock.fastForward(2_000);
  await expectUnlocked(page);

  await page.clock.fastForward(FIVE_MINUTES_MS - 1_000);
  await expectLocked(page);
});

test("A to B to A requires a new unlock and starts a full five-minute session", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const first = { index: 3, password: "Auto-Lock-Account-3-Passphrase-2026!" };
  const second = { index: 7, password: "Auto-Lock-Account-7-Passphrase-2026!" };

  await prepareRegisteredPair(page, first, second);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

  await switchToAccount(page, first);
  await unlockAccountEncryption(page, first.password);
  await page.clock.fastForward(4 * 60_000);

  await switchToAccount(page, second);
  await unlockAccountEncryption(page, second.password);
  await page.clock.fastForward(60_000);

  await switchToAccount(page, first);
  await expectLocked(page);
  await unlockAccountEncryption(page, first.password);

  // The previous address B timer would have fired at t=10:00. Address A must
  // keep the session started at t=06:00 and lock only at t=11:00.
  await page.clock.fastForward(FIVE_MINUTES_MS - 1_000);
  await expectUnlocked(page);
  await page.clock.fastForward(2_000);
  await expectLocked(page);
});

test("deadline and account switch at the boundary stay locked in either event order", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const first = { index: 8, password: "Auto-Lock-Account-8-Passphrase-2026!" };
  const second = { index: 9, password: "Auto-Lock-Account-9-Passphrase-2026!" };

  await prepareRegisteredPair(page, first, second);
  await page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

  await switchToAccount(page, first);
  await unlockAccountEncryption(page, first.password);
  await page.clock.fastForward(FIVE_MINUTES_MS + 10);
  await expectLocked(page);
  await switchToAccount(page, second);
  await expectLocked(page);

  await switchToAccount(page, first);
  await unlockAccountEncryption(page, first.password);
  await page.clock.fastForward(FIVE_MINUTES_MS - 10);
  await switchToAccount(page, second);
  await page.clock.fastForward(20);
  await expectLocked(page);
});
