import { Buffer } from "node:buffer";
import { bytesToHex, type Hex } from "viem";

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ARWEAVE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Arweave transaction IDs are 32-byte values encoded as unpadded Base64URL.
 * The contract stores the raw bytes in bytes32, so storage adapters normalize
 * between the gateway representation and the on-chain representation.
 */
export function normalizeStorageId(value: string): Hex {
  if (BYTES32_PATTERN.test(value)) {
    return value.toLowerCase() as Hex;
  }

  const withoutPadding = value.replace(/=+$/, "");
  if (!ARWEAVE_ID_PATTERN.test(withoutPadding)) {
    throw new Error("存储服务返回了无效的 Arweave 交易 ID");
  }

  const bytes = Buffer.from(withoutPadding, "base64url");
  if (bytes.byteLength !== 32) {
    throw new Error("Arweave 交易 ID 必须对应 32 字节");
  }

  return bytesToHex(bytes);
}

export function toArweaveTransactionId(storageId: Hex): string {
  if (!BYTES32_PATTERN.test(storageId)) {
    throw new Error("无效的 bytes32 存储引用");
  }

  return Buffer.from(storageId.slice(2), "hex").toString("base64url");
}
