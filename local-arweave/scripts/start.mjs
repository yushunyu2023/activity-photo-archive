import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Arweave from "arweave";

const require = createRequire(import.meta.url);
const ArLocal = require("arlocal").default;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, ".data");
const arlocalData = path.join(dataRoot, "arlocal");
const walletPath = path.join(dataRoot, "wallet.json");
const gatewayPort = parsePort("ARLOCAL_PORT", 1984);
const uploadPort = parsePort("ARLOCAL_UPLOAD_PORT", 1985);
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const minterBalance = 1_000_000_000_000_000n;
const mintThreshold = 100_000_000_000_000n;
const maxUploadBytes = 26 * 1024 * 1024;

const arweave = Arweave.init({
  host: "127.0.0.1",
  port: gatewayPort,
  protocol: "http",
  timeout: 10_000,
  logging: false,
});

const arlocal = new ArLocal(
  gatewayPort,
  process.env.ARLOCAL_SHOW_LOGS === "true",
  arlocalData,
  true,
);

let uploadServer;
let shuttingDown = false;

await main();

async function main() {
  await mkdir(dataRoot, { recursive: true });
  await arlocal.start();
  await waitForGateway();

  const wallet = await loadOrCreateWallet();
  const address = await arweave.wallets.jwkToAddress(wallet);
  await ensureBalance(address);

  uploadServer = createServer((request, response) => {
    handleRequest(request, response, wallet).catch((error) => {
      const status = error.statusCode ?? 500;
      const message =
        error instanceof Error ? error.message : "本地 Arweave 服务请求失败";
      console.error(`[local-arweave] ${message}`);
      sendJson(response, status, { error: message });
    });
  });

  uploadServer.requestTimeout = 60_000;
  uploadServer.headersTimeout = 10_000;
  await listen(uploadServer, uploadPort);

  console.log(`[local-arweave] gateway: ${gatewayUrl}`);
  console.log(`[local-arweave] uploader: http://127.0.0.1:${uploadPort}`);
  console.log(`[local-arweave] wallet: ${address}`);
  console.log("[local-arweave] persistence: enabled");
}

async function handleRequest(request, response, wallet) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/health") {
    const walletAddress = await arweave.wallets.jwkToAddress(wallet);
    sendJson(response, 200, {
      status: "ok",
      gateway: gatewayUrl,
      walletAddress,
      persistence: true,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/upload") {
    const body = await readRequestBody(request, maxUploadBytes);
    const contentType =
      headerValue(request.headers["content-type"]) ??
      "application/octet-stream";
    const tags = parseTags(headerValue(request.headers["x-arweave-tags"]));
    const txId = await uploadToArLocal(body, contentType, tags, wallet);
    sendJson(response, 200, { txId });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function uploadToArLocal(body, contentType, tags, wallet) {
  const transaction = await arweave.createTransaction({ data: body }, wallet);
  transaction.addTag("Content-Type", contentType);
  for (const [name, value] of Object.entries(tags)) {
    if (name !== "Content-Type") transaction.addTag(name, value);
  }
  await arweave.transactions.sign(transaction, wallet);

  const postResult = await arweave.transactions.post(transaction);
  if (postResult.status < 200 || postResult.status >= 300) {
    throw httpError(502, `ArLocal 拒绝交易 (${postResult.status})`);
  }

  await fetch(`${gatewayUrl}/mine`);
  await waitForConfirmation(transaction.id);

  const stored = await arweave.transactions.getData(transaction.id, {
    decode: true,
  });
  if (Buffer.compare(Buffer.from(stored), body) !== 0) {
    throw httpError(502, "ArLocal 返回的数据与上传内容不一致");
  }

  return transaction.id;
}

async function waitForConfirmation(txId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const status = await arweave.transactions.getStatus(txId);
      if (status.confirmed) return;
    } catch {
      // ArLocal may briefly return 404 between posting and mining.
    }
    await delay(100);
  }
  throw httpError(504, "等待 ArLocal 交易确认超时");
}

async function ensureBalance(address) {
  const current = BigInt(await arweave.wallets.getBalance(address));
  if (current >= mintThreshold) return;

  const response = await fetch(
    `${gatewayUrl}/mint/${address}/${minterBalance.toString()}`,
  );
  if (!response.ok) {
    throw new Error(`ArLocal 测试余额铸造失败 (${response.status})`);
  }
}

async function loadOrCreateWallet() {
  try {
    return JSON.parse(await readFile(walletPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const wallet = await arweave.wallets.generate();
  await mkdir(dataRoot, { recursive: true });
  await writeFile(walletPath, JSON.stringify(wallet), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return wallet;
}

async function waitForGateway() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${gatewayUrl}/info`);
      if (response.ok) return;
    } catch {
      // The gateway starts listening shortly after start() resolves.
    }
    await delay(100);
  }
  throw new Error("ArLocal Gateway 启动超时");
}

async function readRequestBody(request, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) {
      throw httpError(413, "单个加密对象不能超过 26MB");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseTags(rawValue) {
  if (!rawValue) return {};
  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw httpError(400, "X-Arweave-Tags 不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw httpError(400, "X-Arweave-Tags 必须是对象");
  }

  const entries = Object.entries(parsed);
  if (entries.length > 16) throw httpError(400, "存储标签数量过多");
  return Object.fromEntries(
    entries.map(([name, value]) => {
      if (
        !name ||
        name.length > 64 ||
        typeof value !== "string" ||
        value.length > 256
      ) {
        throw httpError(400, "存储标签内容无效");
      }
      return [name, value];
    }),
  );
}

function headerValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePort(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} 必须是有效端口`);
  }
  return value;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[local-arweave] stopping (${signal})`);

  if (uploadServer) {
    await new Promise((resolve) => uploadServer.close(resolve));
  }
  await arlocal.stop();
  setTimeout(() => process.exit(0), 250).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
