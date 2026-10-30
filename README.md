# Activity Photo Archive

Activity Photo Archive 是一个可独立部署的活动照片长期保存项目。用户通过浏览器
钱包访问 DApp，照片在浏览器端加密后上传至 Arweave 或兼容存储服务，Base 合约
保存不可变照片索引、成员权限和密钥代际信息。

项目不依赖任何产品需求、变更记录或缺陷跟踪文档，包含以下内容：

- `src/ActivityPhotoRegistry.sol`：活动、成员、代际密钥清单和照片索引合约
- `script/DeployActivityPhotoRegistry.s.sol`：Foundry 部署脚本
- `test/ActivityPhotoRegistry.t.sol`：合约测试
- `dapp/`：Next.js DApp、钱包连接、客户端加密和浏览器测试
- `local-arweave/`：仅用于本地联调的 Arweave Gateway 和上传适配器
- `lib/`：编译和测试所需依赖

## 运行要求

- Node.js 22 或更高版本
- pnpm 11 或更高版本
- Foundry（`forge`、`anvil`、`cast`）
- 支持 EVM 的浏览器钱包，例如 MetaMask
- 部署 Base 时准备对应网络的 RPC URL 和部署账户私钥

检查工具版本：

```bash
node --version
pnpm --version
forge --version
anvil --version
```

## 安装

项目已经包含 Foundry 依赖，进入项目根目录后直接编译：

```bash
forge build
```

安装 DApp 依赖：

```bash
cd dapp
pnpm install
```

安装本地 Arweave 适配器依赖：

```bash
cd ../local-arweave
pnpm install
```

## 合约检查

在项目根目录执行：

```bash
forge test -vvv
forge fmt --check
```

## 本地完整启动

本地环境由 Anvil、活动照片合约、Arweave 适配器和 DApp 组成。

### 1. 启动 Anvil

打开第一个终端：

```bash
anvil --chain-id 31337
```

默认 RPC 地址为 `http://127.0.0.1:8545`。Anvil 会输出一组测试账户和私钥；
这些私钥只能用于本地开发。

### 2. 部署合约

打开第二个终端，在项目根目录执行：

```bash
forge script \
  script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

部署记录写入：

```text
broadcast/DeployActivityPhotoRegistry.s.sol/31337/run-latest.json
```

可以读取部署地址：

```bash
jq -r '.transactions[0].contractAddress' \
  broadcast/DeployActivityPhotoRegistry.s.sol/31337/run-latest.json
```

### 3. 启动本地 Arweave 适配器

打开第三个终端：

```bash
cd local-arweave
pnpm install
pnpm start
```

服务地址：

- ArLocal Gateway：`http://127.0.0.1:1984`
- 上传适配器：`http://127.0.0.1:1985`

验证上传、确认和读取链路：

```bash
cd local-arweave
pnpm check
```

### 4. 配置 DApp

在 `dapp/` 下创建 `.env.local`：

```bash
cd dapp
cp .env.example .env.local
```

填写以下值：

```env
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_CONTRACT_ADDRESS=0x第2步得到的地址
NEXT_PUBLIC_DEPLOY_BLOCK=0
NEXT_PUBLIC_LOG_BLOCK_RANGE=9000
NEXT_PUBLIC_LOCAL_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

ARWEAVE_UPLOAD_ENDPOINT=http://127.0.0.1:1985/upload
ARWEAVE_UPLOAD_TOKEN=
ARWEAVE_GATEWAY_URL=http://127.0.0.1:1984
```

如果只需要最简本地流程，可以暂时不启动 `local-arweave/`，DApp 会使用
`dapp/.data/storage/` 保存本地加密对象。本地存储仅用于开发联调，不适合生产。

### 5. 启动 DApp

```bash
cd dapp
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:3000`，在钱包中添加或切换到 Chain ID 为 `31337` 的
Anvil 网络，再导入 Anvil 输出的测试账户。

## 部署到 Base Sepolia

复制根目录环境变量模板：

```bash
cp .env.example .env
```

填写：

```env
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=0x...
BASESCAN_API_KEY=...
```

部署：

```bash
forge script \
  script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

部署后记录：

- 合约地址
- 部署交易所在区块号
- 链 ID `84532`

将 DApp 的 `NEXT_PUBLIC_DEPLOY_BLOCK` 设置为部署区块号，避免事件查询从创世块
开始。`NEXT_PUBLIC_LOG_BLOCK_RANGE` 不应超过所用 RPC 服务允许的单次
`eth_getLogs` 区块范围。

## 部署到 Base Mainnet

部署命令与测试网相同，将 RPC 环境和链 ID 替换为主网：

```bash
forge script \
  script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

DApp 生产配置：

```env
NEXT_PUBLIC_CHAIN_ID=8453
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_DEPLOY_BLOCK=...
NEXT_PUBLIC_LOG_BLOCK_RANGE=9000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...

ARWEAVE_UPLOAD_ENDPOINT=https://uploader.example.com/upload
ARWEAVE_UPLOAD_TOKEN=server-side-token
ARWEAVE_GATEWAY_URL=https://arweave.net
```

`ARWEAVE_UPLOAD_TOKEN` 和部署私钥只配置在服务端或部署环境，不要写入公开的
`NEXT_PUBLIC_*` 变量。

## 生产构建与启动

```bash
cd dapp
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm start
```

生产进程至少需要配置 `.env.local` 或平台环境变量中的全部合约与存储参数。

## Arweave 上传适配器

DApp 通过 `POST /api/storage` 调用 `ARWEAVE_UPLOAD_ENDPOINT`。生产上传服务应：

- 接收加密内容，不接触明文照片或安全密码
- 校验请求大小、类型、标签和鉴权信息
- 管理 AR 余额、交易签名、重试和限流
- 等待交易确认且内容可读后再返回交易 ID
- 为上传和读取配置超时、监控和告警

成功响应格式：

```json
{
  "txId": "43-character-arweave-transaction-id"
}
```

也接受 `{ "id": "..." }`。读取时 DApp 使用 `ARWEAVE_GATEWAY_URL` 从 Gateway
获取密文，并在解密前校验链上记录的内容哈希。

## 本地数据

- Anvil 数据默认只保存在运行中的内存，停止后清空
- `dapp/.data/storage/` 保存未配置远程存储时的本地开发密文
- `local-arweave/.data/` 保存本地 Arweave 数据和测试钱包

清空本地 Arweave 数据：

```bash
cd local-arweave
pnpm reset -- --yes
```

## 浏览器测试

先启动 Anvil、部署合约、启动 Arweave 适配器和 DApp，然后执行：

```bash
cd dapp
pnpm test:e2e
```

自定义测试地址：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 \
PLAYWRIGHT_ANVIL_RPC_URL=http://127.0.0.1:8545 \
pnpm test:e2e
```

## 安全注意事项

- 生产部署前必须进行独立合约安全审计。
- 部署私钥、RPC 凭据和上传服务令牌不得提交到版本库。
- 照片和描述在离开浏览器前必须保持加密。
- 安全密码无法由平台找回；用户需要在离线位置妥善保管。
- Arweave 上传服务应在返回成功前确认交易和数据可读取。
- 生产环境应配置可靠的网关、监控、限流、备份策略和事件索引服务。
