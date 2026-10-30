import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { toArweaveTransactionId } from "@/lib/storage-id.server";

export const runtime = "nodejs";

const TX_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isValidTxId(txId: string): boolean {
  return TX_ID_PATTERN.test(txId);
}

async function fetchFromGateway(txId: string): Promise<Response | null> {
  const gateway = process.env.ARWEAVE_GATEWAY_URL;
  if (!gateway) return null;

  const arweaveId = toArweaveTransactionId(txId as `0x${string}`);
  const response = await fetch(`${gateway.replace(/\/$/, "")}/${arweaveId}`, {
    cache: "no-store",
  });
  return response.ok ? response : null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ txId: string }> },
) {
  const { txId } = await context.params;
  if (!isValidTxId(txId)) {
    return NextResponse.json({ error: "无效的对象 ID" }, { status: 400 });
  }

  try {
    if (process.env.ARWEAVE_GATEWAY_URL) {
      const gatewayResponse = await fetchFromGateway(txId);
      if (gatewayResponse) return gatewayResponse;
    }

    const storageRoot = path.join(process.cwd(), ".data", "storage");
    const key = txId.slice(2);
    const [bytes, metadataRaw] = await Promise.all([
      readFile(path.join(storageRoot, `${key}.bin`)),
      readFile(path.join(storageRoot, `${key}.json`), "utf8"),
    ]);
    const metadata = JSON.parse(metadataRaw) as { contentType?: string };
    const body = new Uint8Array(bytes);

    return new NextResponse(body, {
      headers: {
        "Content-Type": metadata.contentType ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "对象不存在或暂时不可用" }, { status: 404 });
  }
}
