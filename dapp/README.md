# Activity Photo DApp

该目录是 Activity Photo Archive 的 Next.js 前端。浏览器负责读取图片、生成预览、
派生加密身份并使用 AES-256-GCM 加密数据；Base 合约保存公开索引和权限；Arweave
或兼容上传服务保存密文。

完整的项目安装、合约部署、环境变量和启动步骤见
[`../README.md`](../README.md)。

## 技术栈

- Next.js 16、React 19、TypeScript
- wagmi、viem、TanStack Query
- MetaMask 等注入钱包、Coinbase Wallet、WalletConnect
- Web Crypto、Noble X25519、exifr

## 环境变量

从模板创建本地配置：

```bash
cp .env.example .env.local
```

基础配置：

```env
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_DEPLOY_BLOCK=0
NEXT_PUBLIC_LOG_BLOCK_RANGE=9000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
```

本地 Anvil 还需要：

```env
NEXT_PUBLIC_LOCAL_RPC_URL=http://127.0.0.1:8545
```

本地 Arweave 适配器配置：

```env
ARWEAVE_UPLOAD_ENDPOINT=http://127.0.0.1:1985/upload
ARWEAVE_UPLOAD_TOKEN=
ARWEAVE_GATEWAY_URL=http://127.0.0.1:1984
```

生产环境必须配置可用的 Arweave 上传适配器和 Gateway：

```env
ARWEAVE_UPLOAD_ENDPOINT=https://uploader.example.com/upload
ARWEAVE_UPLOAD_TOKEN=server-side-token
ARWEAVE_GATEWAY_URL=https://arweave.net
```

## 启动

```bash
pnpm install
pnpm dev
```

开发地址默认为 `http://127.0.0.1:3000`。

## 生产构建

```bash
pnpm build
pnpm start
```

## 存储适配器协议

DApp 通过服务端路由隔离不同的文件存储实现。上传请求约定：

- 请求体是加密二进制或加密 JSON 的原始字节。
- `Content-Type` 为 `application/octet-stream` 或 `application/json`。
- `X-Arweave-Tags` 是公开标签的 JSON 序列化结果，不包含姓名、描述等敏感信息。
- 成功响应为 `{ "txId": "<43字符交易ID>" }` 或 `{ "id": "..." }`。
- 上传服务应等待数据可读取后再返回，并自行处理付款、重试、鉴权和限流。

合约中的 `bytes32` 引用是 Arweave 43 字符交易 ID 解码后的 32 字节原值，DApp
负责在两种表示之间转换。

## 检查

```bash
pnpm typecheck
pnpm build
pnpm test:e2e
```

端到端测试需要先启动 Anvil、部署合约并启动 DApp。测试钱包地址和启动方式见
[`tests/anvil-wallet.ts`](tests/anvil-wallet.ts)。
