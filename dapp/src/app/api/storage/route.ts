import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { normalizeStorageId } from "@/lib/storage-id.server";

export const runtime = "nodejs";

type StorageMetadata = {
  contentType: string;
  tags: Record<string, string>;
  createdAt: string;
  mode: "local";
};

function parseTags(value: FormDataEntryValue | null): Record<string, string> {
  if (typeof value !== "string" || !value) return {};

  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("存储标签格式无效");
  }

  const entries = Object.entries(parsed);
  if (entries.length > 16) throw new Error("存储标签数量过多");

  return Object.fromEntries(
    entries.map(([key, tagValue]) => {
      if (
        !key ||
        key.length > 64 ||
        typeof tagValue !== "string" ||
        tagValue.length > 256
      ) {
        throw new Error("存储标签内容无效");
      }
      return [key, tagValue];
    }),
  );
}

async function uploadToExternalProvider(
  file: File,
  tags: Record<string, string>,
): Promise<string | null> {
  const endpoint = process.env.ARWEAVE_UPLOAD_ENDPOINT;
  if (!endpoint) return null;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Arweave-Tags": JSON.stringify(tags),
      ...(process.env.ARWEAVE_UPLOAD_TOKEN
        ? { Authorization: `Bearer ${process.env.ARWEAVE_UPLOAD_TOKEN}` }
        : {}),
    },
    body: await file.arrayBuffer(),
  });

  if (!response.ok) {
    throw new Error(`生产存储服务上传失败 (${response.status})`);
  }

  const payload = (await response.json()) as {
    txId?: string;
    id?: string;
  };
  const txId = payload.txId ?? payload.id;
  if (!txId) throw new Error("生产存储服务未返回交易 ID");

  return normalizeStorageId(txId);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const tagsValue = form.get("tags");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少加密文件" }, { status: 400 });
    }

    // Encrypted payloads add a small AES-GCM tag to the 25MB source limit.
    if (file.size > 26 * 1024 * 1024) {
      return NextResponse.json({ error: "单个加密对象不能超过 26MB" }, { status: 413 });
    }

    const tags = parseTags(tagsValue);

    const externalTxId = await uploadToExternalProvider(file, tags);
    if (externalTxId) {
      return NextResponse.json({ txId: externalTxId, mode: "arweave" });
    }

    const txId = `0x${randomBytes(32).toString("hex")}`;
    const storageRoot = path.join(process.cwd(), ".data", "storage");
    await mkdir(storageRoot, { recursive: true });

    const metadata: StorageMetadata = {
      contentType: file.type || "application/octet-stream",
      tags,
      createdAt: new Date().toISOString(),
      mode: "local",
    };

    await Promise.all([
      writeFile(path.join(storageRoot, `${txId.slice(2)}.bin`), Buffer.from(await file.arrayBuffer())),
      writeFile(
        path.join(storageRoot, `${txId.slice(2)}.json`),
        JSON.stringify(metadata),
        "utf8",
      ),
    ]);

    return NextResponse.json({ txId, mode: "local" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
