import type { Hex } from "viem";
import type { StorageReceipt } from "@/lib/types";

const STORAGE_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;
export const MAX_ENCRYPTED_OBJECT_BYTES = 30 * 1024 * 1024;

export async function readResponseBytesWithLimit(
  response: Response,
  maximumBytes = MAX_ENCRYPTED_OBJECT_BYTES,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("加密对象超过本地安全读取上限");
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new Error("加密对象超过本地安全读取上限");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader
          .cancel("encrypted object exceeds safe read limit")
          .catch(() => undefined);
        throw new Error("加密对象超过本地安全读取上限");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function uploadEncryptedBytes(
  bytes: Uint8Array,
  contentType: string,
  tags: Record<string, string> = {},
): Promise<StorageReceipt> {
  if (bytes.byteLength === 0) {
    throw new Error("不能上传空的加密对象");
  }

  const body = new FormData();
  body.set("file", new Blob([bytes as BlobPart], { type: contentType }), "encrypted.bin");
  body.set("tags", JSON.stringify(tags));

  const response = await fetch("/api/storage", {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const message =
      typeof payload?.error === "string" ? payload.error : "加密对象上传失败";
    throw new Error(message || "加密对象上传失败");
  }

  const receipt = (await response.json()) as Partial<StorageReceipt>;
  if (
    typeof receipt.txId !== "string" ||
    !STORAGE_ID_PATTERN.test(receipt.txId) ||
    (receipt.mode !== "local" && receipt.mode !== "arweave")
  ) {
    throw new Error("存储服务返回了无效回执");
  }

  return receipt as StorageReceipt;
}

export async function fetchEncryptedBytes(txId: Hex): Promise<Uint8Array> {
  const response = await fetch(`/api/storage/${txId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("无法读取加密对象");
  }

  return readResponseBytesWithLimit(response);
}
