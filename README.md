# Activity Photo Archive

Activity Photo Archive 是一个可独立部署的活动照片长期保存项目。照片在浏览器端
加密后上传到 Arweave 或兼容存储服务，Base 合约保存不可变的照片索引、活动成员和
密钥代际信息。

## 主要功能

### 活动与成员权限

- 每个钱包地址最多拥有一个活动。
- owner 可以添加查看者、上传者，并把查看者升级为上传者。
- 上传者可以上传和查看照片，查看者只能查看。
- 有效成员上限为 20 人，包含 owner，不包含已经移除的地址。
- 活动、成员和权限变更都通过钱包交易写入 Base 合约。

### 加密照片归档

- 原图、预览图和元数据都在浏览器端使用 AES-256-GCM 加密。
- Base 合约保存密文引用、内容哈希、元数据哈希、拍摄时间和密钥代际。
- Arweave 只接收密文，不接触安全密码或原始照片。
- 读取时会校验链上哈希，内容不一致时拒绝解密。

### 安全密码与密钥

- 用户只需要保管钱包和安全密码。
- 安全密码通过 Argon2id 和域隔离 HKDF 派生 X25519 身份。
- 派生结果与钱包地址绑定，不写入服务器、链上、Arweave 或浏览器持久化存储。
- 安全密码连续 5 分钟无页面操作后自动锁定，并清理内存中的密钥。

### 时间胶囊

- 只有活动 owner 可以发布时间胶囊，上传者只能发布普通照片。
- 解锁时间按分钟选择，必须晚于发布时间且不超过 30 天。
- 胶囊固定使用发布时的活动密钥代际。
- 照片密钥同时依赖活动代际密钥和随机胶囊密钥。
- 随机胶囊密钥使用 Drand Quicknet tlock 锁定到目标轮次。
- 到达目标时间后仍需通过活动代际权限检查，不能绕过成员权限。
- Beacon 尚未可用、签名异常、密文被篡改或地址没有对应代际授权时，照片保持锁定。

### 钱包支持

- MetaMask 等浏览器注入钱包
- Coinbase Wallet
- WalletConnect

## 项目结构

- `src/ActivityPhotoRegistry.sol`：活动、成员、密钥代际、照片和时间胶囊合约
- `script/DeployActivityPhotoRegistry.s.sol`：Foundry 部署脚本
- `dapp/`：Next.js DApp、钱包连接和浏览器端加密
- `local-arweave/`：本地联调使用的 Arweave Gateway 和上传适配器
- `lib/`：Foundry 编译依赖

## 运行要求

- Node.js 22 或更高版本
- pnpm 11 或更高版本
- Foundry，包含 `forge`、`anvil` 和 `cast`
- MetaMask、Coinbase Wallet 或 WalletConnect 兼容钱包
- 部署 Base 合约所需的 RPC URL 和部署账户私钥

检查工具版本：

```bash
node --version
pnpm --version
forge --version
anvil --version
```

## 安装与编译

编译智能合约：

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

## DApp 配置

唯一完整的 DApp 配置模板是：

```text
dapp/.env.example
```

该文件同时包含合约、钱包、Arweave 和 Drand Quicknet 的全部配置及注释。README 不再
复制另一份参数值，避免文档和实际配置不一致。

创建本地配置：

```bash
cd dapp
cp .env.example .env.local
```

### 活动与合约配置

以下变量对应“活动与成员权限”和链上照片索引功能：

- `NEXT_PUBLIC_CHAIN_ID`：Anvil、Base Sepolia 或 Base Mainnet 的链 ID。
- `NEXT_PUBLIC_CONTRACT_ADDRESS`：当前链上的 `ActivityPhotoRegistry` 地址。
- `NEXT_PUBLIC_DEPLOY_BLOCK`：合约部署交易所在区块。
- `NEXT_PUBLIC_LOG_BLOCK_RANGE`：读取活动和照片事件时的单次区块范围。

`NEXT_PUBLIC_CONTRACT_ADDRESS` 必须和 `NEXT_PUBLIC_CHAIN_ID` 对应，否则 DApp 会读取
错误的合约。

### 钱包配置

以下变量对应钱包连接功能：

- `NEXT_PUBLIC_LOCAL_RPC_URL`：只在 `NEXT_PUBLIC_CHAIN_ID=31337` 时使用。
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`：可选；留空时注入钱包和 Coinbase Wallet
  仍可使用，WalletConnect 不显示。

### 加密照片与 Arweave 配置

以下变量对应照片加密后的上传和读取：

- `ARWEAVE_UPLOAD_ENDPOINT`：服务端上传适配器。
- `ARWEAVE_UPLOAD_TOKEN`：上传适配器鉴权令牌，只在服务端使用。
- `ARWEAVE_GATEWAY_URL`：读取密文使用的 Gateway。

留空 `ARWEAVE_UPLOAD_ENDPOINT` 时，DApp 使用 `dapp/.data/storage/` 保存本地开发
密文。生产环境必须配置真实上传适配器和可靠 Gateway。

### 时间胶囊与 Drand Quicknet 配置

时间胶囊的完整 Quicknet 配置只在 `dapp/.env.example` 中维护：

- `NEXT_PUBLIC_DRAND_QUICKNET_CHAIN_HASH`
- `NEXT_PUBLIC_DRAND_QUICKNET_PUBLIC_KEY`
- `NEXT_PUBLIC_DRAND_QUICKNET_SCHEME_ID`
- `NEXT_PUBLIC_DRAND_QUICKNET_PERIOD_SECONDS`
- `NEXT_PUBLIC_DRAND_QUICKNET_GENESIS_TIME`
- `NEXT_PUBLIC_DRAND_QUICKNET_PRIMARY_URL`
- `NEXT_PUBLIC_DRAND_QUICKNET_FALLBACK_URL`

这些公开协议值必须与 `src/ActivityPhotoRegistry.sol` 中的 Quicknet 参数一致。前端会在
创建或解锁时间胶囊前校验 Gateway 返回的链参数、公钥、签名方案、周期和 genesis time。

主 Gateway 不可用时，前端会尝试备用 Gateway。普通照片上传和查看不依赖 Drand；只有
时间胶囊创建和解锁需要至少一个可用 Gateway。

## 本地完整启动

本地环境包含 Anvil、合约、Arweave 适配器和 DApp。

### 1. 启动 Anvil

打开第一个终端：

```bash
anvil --chain-id 31337
```

默认 RPC 为 `http://127.0.0.1:8545`。Anvil 输出的私钥只能用于本地开发。

### 2. 部署合约

打开第二个终端，在项目根目录执行：

```bash
forge script \
  script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
  --rpc-url http://127.0.0.1:8545 \
  --private-key ${one of anvil assigns } \
  --broadcast
```

部署结果：

```text
broadcast/DeployActivityPhotoRegistry.s.sol/31337/run-latest.json
```

读取合约地址：

```bash
jq -r '.transactions[0].contractAddress' \
  broadcast/DeployActivityPhotoRegistry.s.sol/31337/run-latest.json
```

### 3. 启动本地 Arweave 适配器

打开第三个终端：

```bash
cd local-arweave
pnpm start
```

服务地址：

- Gateway：`http://127.0.0.1:1984`
- 上传适配器：`http://127.0.0.1:1985`

### 4. 配置 DApp, 参见dapp/README.md

### 5. 启动 DApp

```bash
pnpm dev
```

打开 `http://127.0.0.1:3000`，在钱包中添加 Chain ID 为 `31337` 的 Anvil 网络，
然后连接钱包。

## 部署到 Base Sepolia

复制根目录的部署配置：

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

部署后把以下值写入 `dapp/.env.local`：

- `NEXT_PUBLIC_CHAIN_ID=84532`
- 部署得到的 `NEXT_PUBLIC_CONTRACT_ADDRESS`
- 部署交易所在区块的 `NEXT_PUBLIC_DEPLOY_BLOCK`
- 生产 Arweave 上传适配器和 Gateway

## 部署到 Base Mainnet

使用主网 RPC 执行相同部署脚本：

```bash
forge script \
  script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BASESCAN_API_KEY"
```

部署后把以下值写入 `dapp/.env.local`：

- `NEXT_PUBLIC_CHAIN_ID=8453`
- 部署得到的 `NEXT_PUBLIC_CONTRACT_ADDRESS`
- 部署交易所在区块的 `NEXT_PUBLIC_DEPLOY_BLOCK`
- 生产 Arweave 上传适配器和 Gateway

## 生产构建与启动

```bash
cd dapp
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm start
```

`ARWEAVE_UPLOAD_TOKEN` 和部署私钥只能放在服务端或部署平台环境变量中，禁止使用
`NEXT_PUBLIC_*` 暴露。

## Arweave 上传适配器

DApp 通过服务端路由调用 `ARWEAVE_UPLOAD_ENDPOINT`。生产上传服务应：

- 接收加密内容，不接触明文照片或安全密码
- 校验请求大小、类型、标签和鉴权信息
- 管理 AR 余额、交易签名、重试和限流
- 等待交易确认且内容可读后再返回交易 ID
- 为上传和读取配置超时、监控和告警

成功响应：

```json
{
  "txId": "43-character-arweave-transaction-id"
}
```

也接受 `{ "id": "..." }`。合约中的 `bytes32` 引用是 Arweave 43 字符 ID 解码后的
32 字节原值，DApp 负责两种表示之间的转换。

普通照片包含加密原图、加密预览和加密元数据。时间胶囊额外包含一个加密后的 tlock
密文对象。

## 本地数据

- Anvil 数据只保存在运行中的内存，停止后清空
- `dapp/.data/storage/` 保存未配置远程上传服务时的密文
- `local-arweave/.data/` 保存本地 Arweave 数据

清空本地 Arweave 数据：

```bash
cd local-arweave
pnpm reset -- --yes
```

## 安全注意事项

- 生产部署前必须进行独立合约安全审计。
- 部署私钥、RPC 凭据和上传服务令牌不得提交到版本库。
- 照片、预览和描述在离开浏览器前必须保持加密。
- 安全密码无法由平台找回，用户需要在离线位置妥善保管。
- 相同安全密码在不同钱包地址上派生不同身份，不能把安全密码单独作为所有权证明。
- Arweave 上传服务应在返回成功前确认交易和数据可读取。
- Drand 和当前 X25519 方案都不是后量子算法，时间胶囊只用于当前 30 天边界。
- 时间胶囊发布后不可修改、取消或提前解锁。
