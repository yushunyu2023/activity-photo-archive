import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ANVIL_RPC_URL, installAnvilWallet } from "./anvil-wallet";

async function sendAnvilRpc(
  request: APIRequestContext,
  method: string,
  params: unknown[],
) {
  const response = await request.post(ANVIL_RPC_URL, {
    data: {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    },
  });
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as { error?: { message?: string } };
  expect(payload.error).toBeUndefined();
}

test("rejected security-password registration can be restarted with a new password", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const isolatedAddress = `0x${randomBytes(20).toString("hex")}`;

  await sendAnvilRpc(request, "anvil_setBalance", [
    isolatedAddress,
    "0x21e19e0c9bab2400000",
  ]);
  await sendAnvilRpc(request, "anvil_impersonateAccount", [isolatedAddress]);

  await installAnvilWallet(page, {
    accounts: [isolatedAddress],
    sendMode: "reject-once",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "连接钱包" }).click();
  await page
    .locator(".wallet-option")
    .filter({ hasText: "MetaMask" })
    .click();

  await expect(
    page.getByRole("heading", { name: "设置安全密码" }),
  ).toBeVisible({ timeout: 20_000 });

  const firstPassword = "Rejected-Security-Password-2026!";
  await page
    .getByPlaceholder("12 至 128 个字符，建议使用长密码或多个词语")
    .fill(firstPassword);
  await page.getByPlaceholder("再次输入").fill(firstPassword);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "设置并登记安全密码" })
    .click();

  await expect(
    page.getByText(/本次设置未登记，可以重新设置安全密码/),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "设置安全密码" }),
  ).toBeVisible();

  const replacementPassword = "Replacement-Security-Password-2026!";
  await page
    .getByPlaceholder("12 至 128 个字符，建议使用长密码或多个词语")
    .fill(replacementPassword);
  await page.getByPlaceholder("再次输入").fill(replacementPassword);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "设置并登记安全密码" })
    .click();

  await expect(
    page.getByRole("heading", { name: "解锁安全密码" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("输入安全密码").fill(replacementPassword);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "解锁安全密码", exact: true })
    .click();
  await expect(page.locator(".vault-status")).toContainText(
    "安全密码已解锁",
  );
});
