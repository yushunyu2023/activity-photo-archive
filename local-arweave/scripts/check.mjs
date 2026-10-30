const uploaderUrl = process.env.ARLOCAL_UPLOAD_URL ?? "http://127.0.0.1:1985";
const gatewayUrl = process.env.ARLOCAL_GATEWAY_URL ?? "http://127.0.0.1:1984";
const source = Buffer.from("activity-photo-arlocal-check", "utf8");

const healthResponse = await fetch(`${uploaderUrl}/health`);
if (!healthResponse.ok) {
  throw new Error(`上传服务健康检查失败 (${healthResponse.status})`);
}
const health = await healthResponse.json();

const uploadResponse = await fetch(`${uploaderUrl}/upload`, {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Arweave-Tags": JSON.stringify({
      app: "activity-photo-dapp",
      type: "integration-check",
    }),
  },
  body: source,
});
if (!uploadResponse.ok) {
  const body = await uploadResponse.text();
  throw new Error(`上传检查失败 (${uploadResponse.status}): ${body}`);
}

const receipt = await uploadResponse.json();
if (!/^[A-Za-z0-9_-]{43}$/.test(receipt.txId ?? "")) {
  throw new Error("上传服务未返回有效的 Arweave 交易 ID");
}

const dataResponse = await fetch(`${gatewayUrl}/${receipt.txId}`);
if (!dataResponse.ok) {
  throw new Error(`Gateway 读取失败 (${dataResponse.status})`);
}
const stored = Buffer.from(await dataResponse.arrayBuffer());
if (!stored.equals(source)) {
  throw new Error("Gateway 返回内容与上传内容不一致");
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      gateway: gatewayUrl,
      uploader: uploaderUrl,
      wallet: health.walletAddress,
      txId: receipt.txId,
      roundTrip: true,
    },
    null,
    2,
  ),
);
