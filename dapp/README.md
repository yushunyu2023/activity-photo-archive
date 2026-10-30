# Activity Photo DApp

完整的合约部署和项目启动步骤见 [`../README.md`](../README.md)。

## 快速启动

先在项目根目录完成合约和本地 Arweave 服务启动，然后执行：
```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:3000`。

`.env.example` 默认使用本地 Anvil、本地 Arweave 上传适配器和 ArLocal Gateway。
启动前必须把 `NEXT_PUBLIC_CONTRACT_ADDRESS` 设置为当前链上
`ActivityPhotoRegistry` 的地址。

## 配置

唯一完整的 DApp 配置模板是 [`.env.example`](.env.example)。所有配置值和注释都只在
该文件中维护，包括：

- 活动与合约：链 ID、合约地址、部署区块和事件读取范围
- 钱包连接：本地 RPC 和 WalletConnect Project ID
- 照片存储：Arweave 上传适配器和 Gateway
- 时间胶囊：Drand Quicknet 协议参数、主 Gateway 和备用 Gateway

不要在其他文档中复制第二份配置值。修改环境时直接编辑 `.env.local`。

### 活动与权限

`NEXT_PUBLIC_CHAIN_ID`、`NEXT_PUBLIC_CONTRACT_ADDRESS` 和
`NEXT_PUBLIC_DEPLOY_BLOCK` 决定 DApp 读取哪个活动合约。合约地址与链 ID 不一致时，
活动列表、成员权限和照片索引都无法正常工作。

### 照片加密与存储

加密始终在浏览器完成。`ARWEAVE_UPLOAD_ENDPOINT` 和 `ARWEAVE_UPLOAD_TOKEN` 只由
服务端上传路由读取，不会发送到浏览器。读取密文时使用 `ARWEAVE_GATEWAY_URL`。

如果上传适配器地址为空，DApp 使用 `dapp/.data/storage/` 保存本地开发密文。生产环境
必须配置真实上传适配器和可靠 Gateway。

### 时间胶囊

时间胶囊使用 `.env.example` 中的 `NEXT_PUBLIC_DRAND_QUICKNET_*` 配置。这些公开协议
值必须与链上 `ActivityPhotoRegistry` 一致，前端会校验 Gateway 返回的链参数、公钥、
签名方案、周期和 genesis time。

主 Gateway 不可用时前端会尝试备用 Gateway。普通照片功能不依赖 Drand；只有时间胶囊
创建和解锁需要至少一个可用 Gateway。

## 用户操作流程

1. 连接钱包并切换到配置的链。
2. 新地址创建安全密码并登记派生公钥。
3. 没有活动的地址可以创建活动并初始化密钥。
4. owner 添加查看者或上传者，并授权对应密钥代际。
5. 有上传权限的地址选择照片，填写一句话描述并发布。
6. 浏览器加密照片后上传密文，再通过钱包写入 Base 合约。
7. 有对应代际权限的地址解锁安全密码后查看照片。
8. owner 可以为照片设置不超过 30 天的时间胶囊。

## 生产构建

完成 `.env.local` 或部署平台环境变量配置后执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm start
```

`ARWEAVE_UPLOAD_TOKEN` 只能配置在服务端环境变量中，不能使用 `NEXT_PUBLIC_*`。

## 存储适配器协议

上传请求约定：

- 请求体是加密二进制或加密 JSON 的原始字节。
- `Content-Type` 为 `application/octet-stream` 或 `application/json`。
- `X-Arweave-Tags` 是公开标签 JSON，不包含姓名、描述等敏感信息。
- 成功响应为 `{ "txId": "<43字符交易ID>" }` 或 `{ "id": "..." }`。
- 上传服务应等待数据可读取后再返回，并处理付款、重试、鉴权和限流。

合约中的 `bytes32` 引用是 Arweave 43 字符交易 ID 解码后的 32 字节原值，DApp
负责两种表示之间的转换。
