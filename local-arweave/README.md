# Local Arweave Integration

仅用于集成测试的隔离环境：

- ArLocal Gateway：`http://127.0.0.1:1984`
- 本地上传适配器：`http://127.0.0.1:1985`
- 持久化数据：`local-arweave/.data/`
- 测试钱包：`local-arweave/.data/wallet.json`

ArLocal 不是永久存储，也不是 Arweave 公共测试网。此环境只验证上传、确认和读取链路。

## 安装

需要 Node.js 22 或更高版本：

```bash
node --version
cd local-arweave
pnpm install
```

如果 `node --version` 仍显示 12、16 或 18，请先把终端使用的 Node 切换到
Node.js 22/24；否则 Next.js 和本服务都无法正常运行。

## 启动

```bash
pnpm start
```

网关和上传服务由同一个进程维护。停止后再次启动会复用 `.data/`，因此已经上传的
对象仍然可读。

## 检查

保持服务运行，另开终端：

```bash
pnpm check
```

检查会真实上传一份测试数据、等待 ArLocal 确认、通过 Gateway 读回并逐字节比较。

## 配置 DApp

在新的 `dapp/.env.local` 中加入：

```env
ARWEAVE_UPLOAD_ENDPOINT=http://127.0.0.1:1985/upload
ARWEAVE_GATEWAY_URL=http://127.0.0.1:1984
```

`ARWEAVE_UPLOAD_TOKEN` 保持为空。

## 全量新环境

先停止当前本地 Arweave 服务，再执行：

```bash
pnpm reset -- --yes
pnpm start
```

`reset` 只删除 `local-arweave/.data/`，不会删除 Anvil、Base 或 DApp 数据。
