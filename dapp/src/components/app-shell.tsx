"use client";

import {
  Archive,
  HardDrive,
  Images,
  KeyRound,
  LockKeyhole,
  Menu,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { useKeyVault } from "@/components/key-vault-provider";
import { WalletButton } from "@/components/wallet-button";
import { ACTIVITY_PHOTO_REGISTRY_ABI, REGISTRY_ADDRESS } from "@/lib/contract";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";

const NAV_ITEMS = [
  { href: "/", label: "我的活动", icon: Images },
  { href: "/activities/new", label: "创建活动", icon: Plus },
];

export function AppShell({
  children,
  storageMode,
}: {
  children: ReactNode;
  storageMode: "local" | "arweave";
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { accountEncryptionStatus, unlocked, openDialog, lock } = useKeyVault();
  const previousAddress = useRef<string | undefined>(address);
  const {
    data: ownedActivityId,
    isPending: ownedActivityLoading,
    isError: ownedActivityError,
  } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getActivityIdByOwner",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(
        address &&
          REGISTRY_ADDRESS &&
          isConnected &&
          chainId === TARGET_CHAIN_ID,
      ),
    },
  });
  const showCreateActivity =
    !isConnected ||
    (chainId === TARGET_CHAIN_ID &&
      !ownedActivityLoading &&
      !ownedActivityError &&
      ownedActivityId === 0n);
  const navItems = NAV_ITEMS.filter(
    (item) => item.href !== "/activities/new" || showCreateActivity,
  );

  useEffect(() => {
    if (previousAddress.current && previousAddress.current !== address) {
      lock();
    }
    previousAddress.current = address;
  }, [address, lock]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="Activity Archive 首页">
            <span className="brand-mark">
              <Archive size={20} />
            </span>
            <span>
              <strong>Activity Archive</strong>
              <small>PRIVATE PHOTO LEDGER</small>
            </span>
          </Link>

          <nav className="desktop-nav" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/"
                  ? pathname === "/" || pathname.startsWith("/activities/")
                  : pathname === item.href;
              return (
                <Link
                  className={active ? "nav-link nav-link-active" : "nav-link"}
                  href={item.href}
                  key={item.href}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="topbar-actions">
            {isConnected ? (
              <button
                className={
                  unlocked ? "vault-status vault-status-open" : "vault-status"
                }
                type="button"
                onClick={openDialog}
              >
                {unlocked ? <KeyRound size={16} /> : <LockKeyhole size={16} />}
                <span>
                  {unlocked
                    ? "安全密码已解锁"
                    : accountEncryptionStatus === "checking"
                      ? "确认安全密码"
                      : accountEncryptionStatus === "unregistered"
                        ? "设置安全密码"
                        : accountEncryptionStatus === "read_error"
                          ? "安全密码状态异常"
                          : accountEncryptionStatus === "incompatible"
                            ? "安全密码不兼容"
                            : accountEncryptionStatus === "wrong_network"
                              ? "切换网络后使用"
                              : "解锁安全密码"}
                </span>
              </button>
            ) : null}
            <WalletButton />
            <button
              className="icon-button mobile-menu-button"
              type="button"
              aria-label={mobileNavOpen ? "关闭导航" : "打开导航"}
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {mobileNavOpen ? (
          <nav className="mobile-nav" aria-label="移动端导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link href={item.href} key={item.href}>
                  <Icon size={17} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>

      {storageMode === "local" ? (
        <div className="storage-mode-banner" role="status">
          <div className="storage-mode-inner">
            <HardDrive size={15} />
            <strong>本地开发存储</strong>
            <span>
              密文只保存在当前开发服务器，不会永久写入 Arweave。生产环境需配置
              <code>ARWEAVE_UPLOAD_ENDPOINT</code>。
            </span>
          </div>
        </div>
      ) : null}

      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <span>
          {storageMode === "local"
            ? "当前为本地密文存储；Base 仅保存来源与权限。"
            : "照片密文存储于 Arweave；Base 仅保存来源与权限。"}
        </span>
        <span>请妥善保存安全密码，密码无法找回。</span>
      </footer>
    </div>
  );
}
