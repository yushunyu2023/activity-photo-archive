import { expect, test } from "@playwright/test";

test("home, wallet dialog, and invalid routes render safely", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "把活动记忆留在可验证的时间里。" }),
  ).toBeVisible();
  await expect(page.getByText("本地开发存储")).toBeVisible();
  await expect(page.getByRole("button", { name: "连接钱包" })).toBeVisible();
  await expect(page.locator(".vault-status")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  await page.getByRole("button", { name: "连接钱包" }).click();
  await expect(page.getByRole("heading", { name: "选择钱包" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Coinbase Wallet/ })).toBeVisible();
  await expect(page.getByText("未检测到 MetaMask。", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "test-results/home-wallet-desktop.png",
    fullPage: true,
  });

  await page.goto("/activities/not-a-activity");
  await expect(page.getByText("404", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile layout remains readable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/activities/new");

  await expect(
    page.getByRole("heading", { name: "创建活动保险箱" }),
  ).toBeVisible();
  await expect(page.getByText("本地开发存储")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);

  await page.screenshot({
    path: "test-results/create-activity-mobile.png",
    fullPage: true,
  });
});

test("browser extension body attributes do not trigger hydration errors", async ({
  page,
}) => {
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|didn't match|did not match/i.test(message.text())
    ) {
      hydrationErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const injectExtensionAttributes = () => {
      if (!document.body) return;
      document.body.setAttribute(
        "data-new-gr-c-s-check-loaded",
        "14.1341.0",
      );
      document.body.setAttribute("data-gr-ext-installed", "");
    };

    new MutationObserver(injectExtensionAttributes).observe(document, {
      childList: true,
      subtree: true,
    });
    injectExtensionAttributes();
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "把活动记忆留在可验证的时间里。" }),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-gr-ext-installed",
    "",
  );
  expect(hydrationErrors).toEqual([]);
});

test("local encrypted storage API round-trips bytes", async ({ request }) => {
  const source = Buffer.from("activity-photo-storage-smoke-test", "utf8");
  const upload = await request.post("/api/storage", {
    multipart: {
      file: {
        name: "encrypted.bin",
        mimeType: "application/octet-stream",
        buffer: source,
      },
      tags: JSON.stringify({
        app: "activity-photo-dapp",
        type: "smoke-test",
      }),
    },
  });

  expect(upload.status()).toBe(200);
  const receipt = (await upload.json()) as {
    txId: string;
    mode: string;
  };
  expect(receipt.mode).toBe("local");
  expect(receipt.txId).toMatch(/^0x[0-9a-f]{64}$/);

  const download = await request.get(`/api/storage/${receipt.txId}`);
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body())).toEqual(source);
});

test("page responses enforce a nonce-based content security policy", async ({
  page,
  request,
}) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);

  const contentSecurityPolicy =
    response.headers()["content-security-policy"];
  expect(contentSecurityPolicy).toContain("default-src 'self'");
  expect(contentSecurityPolicy).toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/_-]+={0,2}'/,
  );
  expect(contentSecurityPolicy).toContain("object-src 'none'");
  expect(contentSecurityPolicy).toContain("base-uri 'self'");
  expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");

  await page.goto("/");
  const scriptNonces = await page.locator("script").evaluateAll((scripts) =>
    scripts.map((script) => (script as HTMLScriptElement).nonce),
  );
  expect(scriptNonces.some(Boolean)).toBe(true);
});
