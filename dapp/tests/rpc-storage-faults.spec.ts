import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type Route,
} from "@playwright/test";
import { toFunctionSelector } from "viem";
import { ANVIL_RPC_URL, installAnvilWallet } from "./anvil-wallet";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const GET_ACTIVITY_ID_BY_OWNER_SELECTOR = toFunctionSelector(
  "function getActivityIdByOwner(address)",
).toLowerCase();

type RpcMode =
  | "pass"
  | "fail-owner-preflight"
  | "fail-photo-logs"
  | "unknown-receipt";

type JsonRpcRequest = {
  id: number | string;
  method: string;
  params?: unknown[];
};

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
  const payload = (await response.json()) as {
    result?: unknown;
    error?: { message?: string };
  };
  expect(payload.error).toBeUndefined();
  return payload.result;
}

async function installRpcFaultRouter(page: Page) {
  let mode: RpcMode = "pass";
  let sendCalls = 0;
  let receiptCalls = 0;
  let actualTransactionHash: string | null = null;

  await page.route(ANVIL_RPC_URL, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    let payload: JsonRpcRequest;
    try {
      payload = request.postDataJSON() as JsonRpcRequest;
    } catch {
      await route.continue();
      return;
    }

    if (payload.method === "eth_sendTransaction") {
      sendCalls += 1;
    }
    if (payload.method === "eth_getTransactionReceipt") {
      receiptCalls += 1;
    }

    if (
      mode === "fail-owner-preflight" &&
      payload.method === "eth_call"
    ) {
      const call = payload.params?.[0] as { data?: string } | undefined;
      if (
        call?.data?.toLowerCase().startsWith(
          GET_ACTIVITY_ID_BY_OWNER_SELECTOR,
        )
      ) {
        await route.fulfill({
          status: 200,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            error: {
              code: -32000,
              message: "mock owner preflight RPC unavailable",
            },
          }),
        });
        return;
      }
    }

    if (mode === "fail-photo-logs" && payload.method === "eth_getLogs") {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: {
            code: -32000,
            message: "mock photo log RPC unavailable",
          },
        }),
      });
      return;
    }

    if (mode === "unknown-receipt") {
      if (payload.method === "eth_sendTransaction") {
        const response = await route.fetch();
        const responseText = await response.text();
        const responsePayload = JSON.parse(responseText) as {
          result?: string;
          error?: { message?: string };
        };
        if (responsePayload.error) {
          throw new Error(responsePayload.error.message);
        }
        actualTransactionHash = responsePayload.result ?? null;
        await route.fulfill({
          status: response.status(),
          headers: {
            ...response.headers(),
            "access-control-allow-origin": "*",
          },
          body: responseText,
        });
        return;
      }

      if (payload.method === "eth_getTransactionReceipt") {
        await route.fulfill({
          status: 200,
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: null,
          }),
        });
        return;
      }
    }

    await route.continue();
  });

  return {
    setMode(nextMode: RpcMode) {
      mode = nextMode;
    },
    get sendCalls() {
      return sendCalls;
    },
    get receiptCalls() {
      return receiptCalls;
    },
    get actualTransactionHash() {
      return actualTransactionHash;
    },
  };
}

async function connectAndRegister(
  page: Page,
  accountIndex: number,
  password: string,
) {
  await installAnvilWallet(page, { initialAccountIndex: accountIndex });
  await page.goto("/");
  await page.getByRole("button", { name: "连接钱包" }).click();
  await page
    .locator(".wallet-option")
    .filter({ hasText: "MetaMask" })
    .click();

  await expect(page.locator(".wallet-account")).toBeVisible();
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
  await expect(page.locator(".vault-status")).toContainText(
    "安全密码已解锁",
  );
}

async function openCreateActivity(page: Page, name: string) {
  await page
    .locator(".desktop-nav")
    .getByRole("link", { name: "创建活动" })
    .click();
  await page.waitForURL(/\/activities\/new$/);
  await page.getByLabel("活动名称").fill(name);
  const createButton = page.getByRole("button", { name: "创建活动" });
  await expect(createButton).toBeEnabled({ timeout: 20_000 });
  return createButton;
}

async function createActivity(
  page: Page,
  name: string,
  initializeKeys: boolean,
) {
  const createButton = await openCreateActivity(page, name);
  await createButton.click();
  await page.waitForURL(/\/activities\/\d+$/, { timeout: 60_000 });
  const activityPath = new URL(page.url()).pathname;

  if (initializeKeys) {
    const initializeButton = page.getByRole("button", { name: "初始化" });
    await expect(initializeButton).toBeEnabled({ timeout: 20_000 });
    await initializeButton.click();
    await expect(
      page.getByText("活动密钥清单尚未初始化"),
    ).not.toBeVisible({ timeout: 60_000 });
  }

  return activityPath;
}

async function uploadPhoto(
  page: Page,
  activityPath: string,
  description: string,
  password: string,
) {
  await page.goto(`${activityPath}/upload`);
  await unlockIfNeeded(page, password);
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: `${description}.png`,
    mimeType: "image/png",
    buffer: ONE_PIXEL_PNG,
  });
  await page.getByLabel("一句话描述").fill(description);
  const publishButton = page.getByRole("button", { name: "加密并发布" });
  await expect(publishButton).toBeEnabled({ timeout: 20_000 });
  await publishButton.click();
  await expect(page.locator(".upload-item")).toHaveCount(0, {
    timeout: 90_000,
  });
}

async function unlockIfNeeded(page: Page, password: string) {
  if (!(await page.locator(".vault-status").textContent())?.includes("已解锁")) {
    await page.locator(".vault-status").click();
    await page.getByPlaceholder("输入安全密码").fill(password);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "解锁安全密码", exact: true })
      .click();
    await expect(page.locator(".vault-status")).toContainText(
      "安全密码已解锁",
    );
  }
}

test("contract preflight error fails closed without requesting wallet send", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await connectAndRegister(
    page,
    1,
    "Preflight-Failure-Passphrase-2026!",
  );
  const createButton = await openCreateActivity(page, "预检失败活动");
  const rpc = await installRpcFaultRouter(page);
  rpc.setMode("fail-owner-preflight");

  await createButton.click();

  await expect(page.locator(".transaction-notice")).toContainText(
    "链上预检失败",
    { timeout: 20_000 },
  );
  expect(rpc.sendCalls).toBe(0);
  await expect(page).toHaveURL(/\/activities\/new$/);
  await expect(
    page.getByRole("button", { name: "创建活动" }),
  ).toBeEnabled({ timeout: 20_000 });
});

test("unknown contract receipt is stored, can be rechecked, and is not resent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await connectAndRegister(
    page,
    2,
    "Unknown-Receipt-Passphrase-2026!",
  );
  const createButton = await openCreateActivity(page, "回执未明活动");
  const rpc = await installRpcFaultRouter(page);
  rpc.setMode("unknown-receipt");

  await createButton.click();

  await expect(page.locator(".transaction-notice")).toContainText(
    "暂时无法读取回执",
    { timeout: 25_000 },
  );
  expect(rpc.sendCalls).toBe(1);
  expect(rpc.actualTransactionHash).toMatch(/^0x[0-9a-f]{64}$/i);
  const pendingCount = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("activity-photo-pending-transaction-v2"),
    ).length,
  );
  expect(pendingCount).toBe(1);

  rpc.setMode("pass");
  await page.getByRole("button", { name: "重新检查链上状态" }).click();
  await expect(page.locator(".transaction-notice")).toContainText(
    "链上状态已确认",
    { timeout: 20_000 },
  );
  expect(rpc.sendCalls).toBe(1);
  const pendingAfterCheck = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("activity-photo-pending-transaction-v2"),
    ).length,
  );
  expect(pendingAfterCheck).toBe(0);
});

test("Arweave upload failure keeps the manifest retryable and does not send a transaction", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await connectAndRegister(
    page,
    3,
    "Storage-Failure-Passphrase-2026!",
  );
  await createActivity(page, "存储失败活动", false);
  const rpc = await installRpcFaultRouter(page);
  let failUpload = true;

  await page.route("**/api/storage", async (route) => {
    if (!failUpload) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "mock Arweave upload unavailable" }),
    });
  });

  const initializeButton = page.getByRole("button", { name: "初始化" });
  await initializeButton.click();
  await expect(
    page.getByText(/mock Arweave upload unavailable/),
  ).toBeVisible({ timeout: 20_000 });
  expect(rpc.sendCalls).toBe(0);
  await expect(
    page.getByText("活动密钥清单尚未初始化"),
  ).toBeVisible();
  const pendingManifestCount = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("activity-photo-pending-manifest-v2"),
    ).length,
  );
  expect(pendingManifestCount).toBe(1);

  failUpload = false;
  await initializeButton.click();
  await expect(
    page.getByText("活动密钥清单尚未初始化"),
  ).not.toBeVisible({ timeout: 60_000 });
  expect(rpc.sendCalls).toBe(1);
});

test("lost Arweave upload response leaves a stored orphan but the same manifest remains retryable", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await connectAndRegister(
    page,
    4,
    "Lost-Response-Passphrase-2026!",
  );
  await createActivity(page, "响应丢失活动", false);
  const rpc = await installRpcFaultRouter(page);
  let orphanTxId: string | null = null;
  let dropResponse = true;

  await page.route("**/api/storage", async (route) => {
    if (!dropResponse || route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = (await response.json()) as { txId?: string };
    orphanTxId = payload.txId ?? null;
    await route.abort("failed");
  });

  const initializeButton = page.getByRole("button", { name: "初始化" });
  await initializeButton.click();
  await expect
    .poll(() => orphanTxId, { timeout: 20_000 })
    .toMatch(/^0x[0-9a-f]{64}$/i);
  expect(orphanTxId).toMatch(/^0x[0-9a-f]{64}$/i);
  expect(rpc.sendCalls).toBe(0);
  const orphanResponse = await request.get(`/api/storage/${orphanTxId}`);
  expect(orphanResponse.ok()).toBe(true);
  const pendingManifestCount = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith("activity-photo-pending-manifest-v2"),
    ).length,
  );
  expect(pendingManifestCount).toBe(1);

  dropResponse = false;
  await initializeButton.click();
  await expect(
    page.getByText("活动密钥清单尚未初始化"),
  ).not.toBeVisible({ timeout: 60_000 });
  expect(rpc.sendCalls).toBe(1);
});

test("Arweave read error blocks preview, while reload after recovery decrypts the photo", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await connectAndRegister(
    page,
    5,
    "Storage-Read-Passphrase-2026!",
  );
  const activityPath = await createActivity(page, "读取失败活动", true);
  await uploadPhoto(
    page,
    activityPath,
    "读取失败测试照片",
    "Storage-Read-Passphrase-2026!",
  );

  let failRead = true;
  const storageReadHandler = async (route: Route) => {
    if (route.request().method() === "GET" && failRead) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "mock gateway unavailable" }),
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/storage/*", storageReadHandler);

  await page.goto(activityPath);
  await unlockIfNeeded(page, "Storage-Read-Passphrase-2026!");
  await expect(page.getByText("无法读取加密对象")).toBeVisible({
    timeout: 30_000,
  });

  failRead = false;
  await page.reload();
  await unlockIfNeeded(page, "Storage-Read-Passphrase-2026!");
  await expect(page.locator(".photo-image-loaded")).toBeVisible({
    timeout: 60_000,
  });
  await page.unroute("**/api/storage/*", storageReadHandler);
});

test("photo index read error is distinct from an empty album and can recover", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await connectAndRegister(
    page,
    6,
    "Photo-Log-Failure-Passphrase-2026!",
  );
  const activityPath = await createActivity(page, "照片索引失败活动", true);
  const rpc = await installRpcFaultRouter(page);
  rpc.setMode("fail-photo-logs");

  await page.goto(activityPath);

  await expect(
    page.getByRole("heading", { name: "暂时无法读取照片时间线" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "这个活动还没有照片" }),
  ).toHaveCount(0);

  rpc.setMode("pass");
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(
    page.getByRole("heading", { name: "这个活动还没有照片" }),
  ).toBeVisible({ timeout: 30_000 });
});
