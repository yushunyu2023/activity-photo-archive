import { expect, test, type Page } from "@playwright/test";
import {
  ANVIL_ACCOUNTS,
  installAnvilWallet,
  switchAnvilAccount,
} from "./anvil-wallet";

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
  await page.locator(".vault-status").click();
  await page.getByPlaceholder("输入安全密码").fill(password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");
}

test("closing a pending wallet request releases the wallet picker", async ({
  page,
}) => {
  await installAnvilWallet(page, { connectMode: "pending" });
  await page.goto("/");
  await page.getByRole("button", { name: "连接钱包" }).click();

  const metaMaskOption = page
    .locator(".wallet-option")
    .filter({ hasText: "MetaMask" });
  await metaMaskOption.click();
  await expect(
    page.getByRole("button", { name: "取消等待并重试" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "连接钱包" }).click();
  await expect(metaMaskOption).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "取消等待并重试" }),
  ).not.toBeVisible();
});

test("deterministic account encryption unlocks after reload and stays address-scoped", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const firstPassword = "Account-One-Passphrase-2026!";
  await installAnvilWallet(page, { initialAccountIndex: 1 });
  await page.goto("/");
  await connectMetaMask(page);
  await expect(page.locator(".wallet-account")).toContainText("0x7099");
  await enableAndUnlockAccountEncryption(page, firstPassword);

  const localState = await page.evaluate(() => ({
    deviceVaultKeys: Object.keys(localStorage).filter((key) =>
      key.startsWith("activity-photo-device-vault"),
    ),
    containsPassword: Object.values(localStorage).some((value) =>
      value.includes("Account-One-Passphrase-2026!"),
    ),
  }));
  expect(localState.deviceVaultKeys).toEqual([]);
  expect(localState.containsPassword).toBe(false);

  await page.reload();
  await expect(page.locator(".wallet-account")).toContainText("0x7099");
  await expect(page.locator(".vault-status")).toContainText("解锁");
  await page.locator(".vault-status").click();
  await page.getByPlaceholder("输入安全密码").fill("Wrong-Password-2026!");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.getByText("安全密码不正确")).toBeVisible();
  await page.getByPlaceholder("输入安全密码").fill(firstPassword);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");

  await switchAnvilAccount(page, 2);
  await expect(page.locator(".wallet-account")).toContainText("0x3C44");
  await expect(page.locator(".vault-status")).toContainText("设置安全密码");
  await expect(
    page.getByRole("heading", { name: "设置安全密码" }),
  ).toBeVisible({ timeout: 20_000 });
});

test("owner rotates keys, promotes a viewer, grants epochs, and permanently removes a member", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const owner = ANVIL_ACCOUNTS[4];
  const member = ANVIL_ACCOUNTS[5];
  const replacementMember = ANVIL_ACCOUNTS[6];
  const ownerPassword = "Owner-Members-Passphrase-2026!";
  const memberPassword = "Member-Members-Passphrase-2026!";

  await installAnvilWallet(page, { initialAccountIndex: 4 });
  await page.goto("/");
  await connectMetaMask(page);
  await enableAndUnlockAccountEncryption(page, ownerPassword);

  await page
    .locator(".desktop-nav")
    .getByRole("link", { name: "创建活动" })
    .click();
  await page.getByLabel("活动名称").fill("成员权限测试");
  await page.getByRole("button", { name: "创建活动" }).click();
  await page.waitForURL(/\/activities\/\d+$/, { timeout: 60_000 });
  const activityUrl = new URL(page.url()).pathname;
  await expect(page.getByText("活动密钥清单尚未初始化")).toBeVisible();
  const initializeButton = page.getByRole("button", { name: "初始化" });
  await expect(initializeButton).toBeEnabled({ timeout: 20_000 });
  await initializeButton.click();
  await expect(
    page.getByText("活动密钥清单尚未初始化"),
  ).not.toBeVisible({ timeout: 60_000 });

  await page.getByRole("link", { name: "成员与密钥" }).click();
  await expect(page.getByText("1/20 人")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "轮换活动密钥" }).click();
  await expect(page.getByText(/密钥已轮换到第 2 代/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".key-state-card h2")).toContainText("第 2 代");

  await page.getByLabel("EVM 钱包地址").fill(member);
  await page.getByLabel("成员类型").selectOption("viewer");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("查看者已添加", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await switchAnvilAccount(page, 5);
  await expect(page.locator(".wallet-account")).toContainText("0x9965");
  await enableAndUnlockAccountEncryption(page, memberPassword);

  await switchAnvilAccount(page, 4);
  await expect(page.locator(".wallet-account")).toContainText("0x15d3");
  await expect(page.locator(".vault-status")).toContainText("解锁");
  await unlockAccountEncryption(page, ownerPassword);

  const memberRow = page
    .locator(".member-row")
    .filter({ hasText: "0x9965...A4dc" });
  await expect(memberRow).toContainText("查看者");
  await memberRow.getByRole("button", { name: "转为上传者" }).click();
  await expect(page.getByText("已转为上传者", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await memberRow.getByRole("button", { name: "授权代际" }).click();
  const grantDialog = page.locator(".grant-dialog");
  await expect(grantDialog).toContainText("上传者 · 含查看权限");
  await grantDialog
    .getByRole("button", { name: "选择全部缺失代际" })
    .click();
  await grantDialog.getByRole("button", { name: /确认授权/ }).click();
  await expect(page.getByText("代际密钥已授权", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(memberRow.locator(".member-access")).toContainText("1-2");
  await expect(
    memberRow.getByRole("button", { name: "授权代际" }),
  ).not.toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await memberRow.getByRole("button", { name: "移除" }).click();
  await expect(page.getByText("上传者已移除", { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  const removedSection = page.locator(".removed-members-section");
  const removedRow = removedSection
    .locator(".removed-member-row")
    .filter({ hasText: "0x9965...A4dc" });
  await expect(removedRow).toContainText("1-2");
  await expect(removedRow).toContainText("仍持有当前代际密钥");

  await page.getByLabel("EVM 钱包地址").fill(member);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(
    page
      .locator(".transaction-notice strong")
      .filter({ hasText: "已被移除，不能再次加入" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(removedRow).toBeVisible();

  await page.getByLabel("EVM 钱包地址").fill(replacementMember);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("查看者已添加", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const replacementRow = page
    .locator(".member-row")
    .filter({ hasText: "0x976E...0aa9" });
  await replacementRow
    .getByRole("button", { name: "转为上传者" })
    .click();
  await expect(page.getByText("已转为上传者", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(replacementRow).toContainText("上传者");

  await switchAnvilAccount(page, 5);
  await expect(page.locator(".wallet-account")).toContainText("0x9965");
  await page.goto(activityUrl);
  await expect(
    page.getByRole("heading", { name: "当前钱包没有活动访问权限" }),
  ).toBeVisible();
  await expect(page.getByText("成员权限测试")).toHaveCount(0);

  await switchAnvilAccount(page, 4);
  await expect(page.locator(".wallet-account")).toContainText("0x15d3");
  await page.goto(`${activityUrl}/members`);
  await unlockAccountEncryption(page, ownerPassword);
  await page.locator(".vault-status").click();
  await page.getByRole("button", { name: "立即锁定" }).click();
  await expect(page.locator(".vault-status")).toContainText("解锁");

  await page.screenshot({
    path: "test-results/members-keys-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({
    path: "test-results/members-keys-mobile.png",
    fullPage: true,
  });
});
