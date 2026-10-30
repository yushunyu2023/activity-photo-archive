"use client";

import {
  ChevronDown,
  Copy,
  LoaderCircle,
  LogOut,
  Network,
  Wallet,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { useToast } from "@/components/toast-provider";
import { TARGET_CHAIN, TARGET_CHAIN_ID } from "@/lib/wagmi";

const WALLET_CONNECTION_TIMEOUT_MS = 15_000;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const [open, setOpen] = useState(false);
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const connectionAttempt = useRef(0);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { pushToast } = useToast();

  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN_ID;
  const supportedWalletNames = new Set([
    "metamask",
    "coinbase wallet",
    "walletconnect",
  ]);
  const walletConnectors = connectors.filter((connector) =>
    supportedWalletNames.has(connector.name.toLowerCase()),
  );
  const hasMetaMask = walletConnectors.some(
    (connector) => connector.name.toLowerCase() === "metamask",
  );

  function closeWalletDialog() {
    connectionAttempt.current += 1;
    setPendingConnector(null);
    setOpen(false);
  }

  async function connect(connector: (typeof connectors)[number]) {
    const attempt = connectionAttempt.current + 1;
    connectionAttempt.current = attempt;
    setPendingConnector(connector.uid);
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        connectAsync({ connector }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("连接钱包超时，请关闭钱包窗口后重试")),
            WALLET_CONNECTION_TIMEOUT_MS,
          );
        }),
      ]);
      if (connectionAttempt.current === attempt) {
        setOpen(false);
      }
    } catch (error) {
      if (connectionAttempt.current === attempt) {
        pushToast({
          tone: "error",
          title: "钱包连接失败",
          description:
            error instanceof Error && /超时/.test(error.message)
              ? "钱包窗口已关闭或未确认连接，请重新选择钱包。"
              : error instanceof Error
                ? error.message
                : "请重试",
        });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (connectionAttempt.current === attempt) {
        setPendingConnector(null);
      }
    }
  }

  async function switchNetwork() {
    try {
      await switchChainAsync({ chainId: TARGET_CHAIN_ID });
    } catch (error) {
      pushToast({
        tone: "error",
        title: "无法切换网络",
        description: error instanceof Error ? error.message : "请在钱包中手动切换",
      });
    }
  }

  if (!isConnected) {
    return (
      <>
        <button
          className="button button-primary wallet-connect-button"
          type="button"
          aria-label="连接钱包"
          title="连接钱包"
          onClick={() => setOpen(true)}
        >
          <Wallet size={17} />
          <span>连接钱包</span>
        </button>
        {open
          ? createPortal(
              <div
                className="dialog-backdrop"
                role="presentation"
                onMouseDown={closeWalletDialog}
              >
                <div
                  className="dialog wallet-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wallet-title"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="dialog-header">
                    <div>
                      <p className="eyebrow">EVM WALLET</p>
                      <h2 id="wallet-title">选择钱包</h2>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="关闭"
                      onClick={closeWalletDialog}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {walletConnectors.length ? (
                    <div className="wallet-list">
                      {walletConnectors.map((connector) => (
                        <button
                          type="button"
                          className="wallet-option"
                          key={connector.uid}
                          onClick={() => connect(connector)}
                          disabled={
                            pendingConnector !== null &&
                            pendingConnector !== connector.uid
                          }
                        >
                          <span className="wallet-mark">
                            {pendingConnector === connector.uid ? (
                              <LoaderCircle className="spin" size={19} />
                            ) : (
                              <Wallet size={19} />
                            )}
                          </span>
                          <span>
                            <strong>{connector.name}</strong>
                            <small>
                              {connector.name === "MetaMask"
                                ? `EVM 智能链钱包 · 连接到 ${TARGET_CHAIN.name}`
                                : connector.name === "WalletConnect"
                                  ? `移动端钱包连接 · ${TARGET_CHAIN.name}`
                                  : `EVM 智能链钱包 · 连接到 ${TARGET_CHAIN.name}`}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {pendingConnector ? (
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => {
                        connectionAttempt.current += 1;
                        setPendingConnector(null);
                      }}
                    >
                      <X size={15} />
                      取消等待并重试
                    </button>
                  ) : null}
                  {!hasMetaMask ? (
                    <div className="callout callout-warning">
                      <Wallet size={18} />
                      <p>
                        未检测到 MetaMask。请安装 MetaMask 浏览器扩展后刷新此页面。
                      </p>
                    </div>
                  ) : null}
                  {!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ? (
                    <p className="inline-note">
                      配置 WalletConnect Project ID 后可连接移动端钱包。
                    </p>
                  ) : null}
                </div>
              </div>,
              document.body,
            )
          : null}
      </>
    );
  }

  return (
    <div className="wallet-connected">
      {wrongNetwork ? (
        <button
          type="button"
          className="button button-warning button-small"
          onClick={switchNetwork}
          disabled={isSwitching}
        >
          <Network size={15} />
          切换到 {TARGET_CHAIN.name}
        </button>
      ) : (
        <span className="network-pill">
          <span className="status-dot" />
          {TARGET_CHAIN.name}
        </span>
      )}
      <div className="wallet-menu">
        <button
          className="wallet-account"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span className="wallet-avatar" />
          {address ? shortAddress(address) : "已连接"}
          <ChevronDown size={14} />
        </button>
        {open ? (
          <div className="wallet-popover">
            <button
              type="button"
              onClick={() => {
                if (address) {
                  void navigator.clipboard.writeText(address);
                  pushToast({ tone: "success", title: "地址已复制" });
                }
              }}
            >
              <Copy size={15} />
              复制地址
            </button>
            <button
              type="button"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              <LogOut size={15} />
              断开连接
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
