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

其他：
合约测试网路相关信息(省掉相关发布的gas)：
网络
- 网络：Base Sepolia
- Chain ID：84532
- RPC URL：https://sepolia.base.org
- 货币：ETH
- 区块浏览器：https://sepolia.basescan.org
新合约
- 合约名称：ActivityPhotoRegistry
- 合约地址：0xB57DF20ec81b3b4b2a406Fc4DDB75893263A5Cf1
- 部署区块：52163202
- 部署账户：0x662061feFa6f704Ac41644bd7D78Bc1890A04752
- 状态：部署成功
合约页面：
https://sepolia.basescan.org/address/0xB57DF20ec81b3b4b2a406Fc4DDB75893263A5Cf1
部署交易
- 交易哈希：0x3e94adc2063eb11fb19090ad59ad284a8f33a7278b05aabe9e4f37ac1c616e43
- Gas 使用量：2,941,060
- 交易状态：成功
交易页面：
https://sepolia.basescan.org/tx/0x3e94adc2063eb11fb19090ad59ad284a8f33a7278b05aabe9e4f37ac1c616e43
旧合约地址 0xFFceE39b...23D6 已不是当前版本。

## 本地环境启动 Prompt

下面的提示词可以直接交给编码代理执行，也可以作为人工启动和验收清单。它要求代理实际
启动环境、回填部署结果并完成连通性检查，而不是只输出命令。

```text
你是一名负责 Web3 本地开发环境落地的资深工程师。请在仓库
https://github.com/yushunyu2023/activity-photo-archive.git
中启动一套可用于人工自测的本地环境。

目标
- 启动 Anvil、ActivityPhotoRegistry 合约、本地 Arweave 适配器和 Next.js DApp。
- 把实际部署结果写入 dapp/.env.local，使开发者打开页面即可连接本地钱包自测。
- 用可复现命令验证链、合约、存储和 DApp 的连通性，再报告成功或明确失败点。
- 不修改合约业务逻辑、DApp 页面行为或安全边界；只为完成本地启动做必要的配置修复，
  并说明每一处修复。

已有材料与优先级
1. 以当前仓库代码为主要依据：README.md、dapp/.env.example、dapp/package.json、
   local-arweave/package.json、foundry.toml 和部署脚本。
2. 使用 dapp/.env.example 作为 DApp 唯一配置模板，保留其中的 Drand Quicknet 参数。
3. 不要根据其他项目、旧 README 或模型记忆猜测端口、链 ID、合约地址或依赖版本。
4. 如果仓库内容与文档冲突，以可执行代码和实际命令输出为准，并在报告中列出冲突。

约束与安全
- 要求 Node.js >= 22、pnpm >= 11，并确认 forge、anvil 可用。如果默认 node 版本过低，
  必须先通过 nvm、fnm 或调整 PATH 切换版本；pnpm、Next.js 和 local-arweave 必须在
  Node.js >= 22 的环境中执行。
- 不把私钥、助记词、RPC 凭据或上传令牌写入 README、源码、.env.local 或 Git 跟踪文件。
- 本地部署使用 Anvil 的解锁测试账户和 forge --unlocked --sender，不传 --private-key。
- 不执行 git reset、git checkout -- 或删除未知工作区内容。
- 不终止来源不明的端口占用进程。先检查 8545、1984、1985、3000，发现冲突时报告占用
  进程并停止相关步骤。
- local-arweave 是 ArLocal 联调服务，不是公共 Arweave 测试网或永久存储。
- 时间胶囊的创建和解锁依赖外部 Drand Gateway；如果外部网络不可用，普通照片链路可
  验收，但必须明确标记时间胶囊未验证，不能把整轮结果写成全部通过。

执行步骤
1. 预检
   - 确认当前目录是仓库根目录；如果尚未克隆，先克隆上面的仓库并进入目录。
   - 记录 git status、Node、pnpm、forge 和 anvil 版本；不覆盖未提交改动。
   - 检查 8545、1984、1985、3000 的监听状态。
   - 执行 forge build。
   - 分别在 dapp 和 local-arweave 执行 pnpm install --frozen-lockfile。
   - 如果安装因 npm Registry 或 GitHub 网络不可达而失败，报告具体域名和缺失依赖，
     不要跳过安装、降低锁文件版本或改用未经项目验证的依赖。
   - 在 dapp 执行 pnpm typecheck。

2. 启动 Anvil
   - 在独立长运行会话中执行：
     anvil --chain-id 31337 --host 127.0.0.1 --port 8545
   - 确认 RPC 返回 chainId 0x7a69。
   - 不在文件或终端报告中记录私钥；后续部署使用解锁账户。

3. 部署合约
   - 在仓库根目录执行：
     forge script \
       script/DeployActivityPhotoRegistry.s.sol:DeployActivityPhotoRegistry \
       --rpc-url http://127.0.0.1:8545 \
       --broadcast \
       --unlocked \
       --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   - 从 broadcast/DeployActivityPhotoRegistry.s.sol/31337/run-latest.json 读取实际
     contractAddress 和 receipts[0].blockNumber；不要假定部署一定成功。
   - 使用 eth_getCode 确认部署地址存在非空字节码。
   - 如果交易已成功但后续配置失败，保留该部署并从 broadcast 文件续做，不要无脑重复部署。

4. 配置 DApp
   - 如果 dapp/.env.local 不存在，从 dapp/.env.example 创建；如果已存在，保留开发者
     的其他未冲突配置。
   - 至少确认以下值：
     NEXT_PUBLIC_CHAIN_ID=31337
     NEXT_PUBLIC_CONTRACT_ADDRESS=<实际部署地址>
     NEXT_PUBLIC_DEPLOY_BLOCK=<实际部署区块十进制值>
     NEXT_PUBLIC_LOCAL_RPC_URL=http://127.0.0.1:8545
     ARWEAVE_UPLOAD_ENDPOINT=http://127.0.0.1:1985/upload
     ARWEAVE_UPLOAD_TOKEN=
     ARWEAVE_GATEWAY_URL=http://127.0.0.1:1984
   - 保留所有 NEXT_PUBLIC_DRAND_QUICKNET_* 参数，值必须与 dapp/.env.example 和合约定义
     一致。
   - 说明 .env.local 是本地个人配置，不得提交敏感值。

5. 启动本地 Arweave
   - 在独立长运行会话中，从 local-arweave 目录执行：
     pnpm start
   - 等待出现 Gateway 1984、Uploader 1985 启动成功日志。
   - 执行 pnpm check，要求真实完成上传、确认、Gateway 读取和逐字节比较。

6. 启动 DApp
   - 在独立长运行会话中，从 dapp 目录执行：
     pnpm dev
   - 确认 http://127.0.0.1:3000 返回 HTTP 200，并检查启动日志没有编译或运行时错误。

验收标准
- RPC：eth_chainId 返回 0x7a69（31337）。
- 合约：eth_getCode 返回非空字节码，且地址与 dapp/.env.local 完全一致。
- Arweave：/info 可访问，Uploader /health 返回 ok，pnpm check 校验通过。
- DApp：首页返回 HTTP 200；/api/storage 至少完成一次上传并读回，内容哈希一致。
- 静态检查：forge build 和 pnpm typecheck 成功。
- 钱包参数：RPC 为 http://127.0.0.1:8545，Chain ID 为 31337，货币符号为 ETH。
- 不把 lint warning、外部 Drand 网络失败或未执行的测试误报为通过。

异常恢复
- 端口被占用：停止启动，报告端口、PID 和占用命令，不擅自 kill。
- Anvil 重启：旧合约和交易状态已丢失；重新部署并更新合约地址和部署区块。
- 部署成功但配置未写入：从 broadcast JSON 恢复地址和区块，不重复部署。
- local-arweave 启动失败：保留并报告完整错误；不要改用 dapp/.data 后仍声称 Arweave
  链路已经验证。
- DApp 能打开但 API 上传失败：视为未通过，继续检查服务端环境变量、1985 连通性和日志。

最终报告
按以下顺序输出：
1. 启动状态：四个服务是否正在运行。
2. 本地参数：DApp URL、RPC URL、Chain ID、合约地址、部署区块。
3. 验证证据：每条验收标准的实际结果。
4. 钱包设置：如何在 MetaMask 添加 31337 网络；说明从本地 Anvil 控制台读取测试账户的
   方法，但不要把私钥复制到仓库或文档。
5. 未验证项或残余风险：例如外部 Drand 网络、时间胶囊、未执行的 E2E。
6. 停止顺序：DApp、local-arweave、Anvil，并说明 Anvil 停止后本地链数据会清空。
```