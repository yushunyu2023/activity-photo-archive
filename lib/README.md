# Vendored Foundry Dependencies

这些依赖随项目一起提供，保证合约在离线环境下仍可编译和测试。

| 目录 | 上游项目 | 版本 |
| --- | --- | --- |
| `forge-std/` | https://github.com/foundry-rs/forge-std | `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` |
| `openzeppelin-contracts/` | https://github.com/OpenZeppelin/openzeppelin-contracts | `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` |

升级依赖后应运行 `forge test` 和 `forge fmt --check`，并保留各上游项目的许可证文件。
