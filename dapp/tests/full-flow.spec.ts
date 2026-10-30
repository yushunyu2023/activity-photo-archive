import { expect, test } from "@playwright/test";
import { installAnvilWallet } from "./anvil-wallet";

const ACCOUNT_PASSWORD = "Activity-Photo-Test-Passphrase-2026!";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("wallet, encrypted upload, timeline, and verified download", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installAnvilWallet(page);

  await page.goto("/");
  await page.getByRole("button", { name: "连接钱包" }).click();
  const anvilWallet = page
    .locator(".wallet-option")
    .filter({ hasText: "MetaMask" });
  await expect(anvilWallet).toBeVisible();
  await anvilWallet.click();

  await expect(page.locator(".wallet-account")).toContainText("0xf39F");
  await expect(page.locator(".network-pill")).toContainText("Anvil Local");
  await expect(
    page.getByRole("heading", { name: "设置安全密码" }),
  ).toBeVisible();
  await page
    .getByPlaceholder("12 至 128 个字符，建议使用长密码或多个词语")
    .fill(ACCOUNT_PASSWORD);
  await page.getByPlaceholder("再次输入").fill(ACCOUNT_PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "设置并登记安全密码" }).click();
  await expect(
    page.getByRole("heading", { name: "解锁安全密码" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("输入安全密码").fill(ACCOUNT_PASSWORD);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");

  await page
    .locator(".desktop-nav")
    .getByRole("link", { name: "创建活动" })
    .click();
  await page.waitForURL(/\/activities\/new$/);
  await page.getByLabel("活动名称").fill("林家记忆");
  const createButton = page.getByRole("button", { name: "创建活动" });
  await expect(createButton).toBeEnabled({ timeout: 20_000 });
  await createButton.click();
  await page.waitForURL(/\/activities\/\d+$/, { timeout: 60_000 });
  const activityUrl = new URL(page.url()).pathname;
  await expect(
    page.getByRole("heading", { name: "林家记忆" }),
  ).toBeVisible();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");
  await expect(page.getByText("活动密钥清单尚未初始化")).toBeVisible();
  await expect(page.getByText(/继续初始化活动/)).toHaveCount(0);
  const initializeKeysButton = page.getByRole("button", { name: "初始化" });
  await expect(initializeKeysButton).toBeEnabled({ timeout: 20_000 });
  await initializeKeysButton.click();
  await expect(
    page.getByText("活动密钥清单尚未初始化"),
  ).not.toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");

  await expect(
    page
      .locator(".desktop-nav")
      .getByRole("link", { name: "创建活动" }),
  ).toHaveCount(0);
  await page.goto("/activities/new");
  await expect(
    page.getByText("当前钱包已经拥有一个活动，每个地址最多创建一个活动。"),
  ).toBeVisible();
  await expect(page.getByLabel("活动名称")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建活动" }),
  ).toHaveCount(0);
  await page.goto(activityUrl);
  await page.locator(".vault-status").click();
  await expect(
    page.getByRole("heading", { name: "解锁安全密码" }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("输入安全密码").fill(ACCOUNT_PASSWORD);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");

  await page.getByRole("link", { name: "上传照片" }).click();
  await page.waitForURL(new RegExp(`${activityUrl}/upload$`));
  await expect(page.locator(".vault-status")).toContainText("安全密码已解锁");
  await page.locator('input[type="file"]').setInputFiles({
    name: "first-activity-photo.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.getByLabel("一句话描述").fill("第一次活动照片测试");
  const publishButton = page.getByRole("button", { name: "加密并发布" });
  await expect(publishButton).toBeEnabled({ timeout: 20_000 });
  await publishButton.click();
  await expect(page.locator(".upload-item")).toHaveCount(0, {
    timeout: 60_000,
  });
  await expect(publishButton).toBeDisabled();

  await page.locator('input[type="file"]').setInputFiles({
    name: "duplicate-activity-photo.png",
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.getByLabel("一句话描述").last().fill("重复照片不应再次上链");
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  await expect(page.getByText("照片已经发布", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".upload-item")).toHaveCount(0);

  await page.getByRole("link", { name: "返回时间线" }).click();
  await page.waitForURL(new RegExp(`${activityUrl}$`));
  await expect(
    page.getByRole("heading", { name: "第一次活动照片测试" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    path: "test-results/activity-timeline.png",
    fullPage: true,
  });

  await page.locator(".photo-card .photo-frame").first().click();
  await page.waitForURL(/\/asset\/0x[0-9a-f]{64}$/i);
  await expect(
    page.getByRole("heading", { name: "第一次活动照片测试" }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "校验并下载原图" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  await page.screenshot({
    path: "test-results/photo-detail.png",
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
