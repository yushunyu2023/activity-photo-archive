import type { Page } from "@playwright/test";

export const ANVIL_RPC_URL =
  process.env.PLAYWRIGHT_ANVIL_RPC_URL ?? "http://127.0.0.1:8545";
export const ANVIL_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
] as const;

type InstallAnvilWalletOptions = {
  rpcUrl?: string;
  accounts?: readonly string[];
  initialAccountIndex?: number;
  connectMode?: "standard" | "pending";
  sendMode?: "standard" | "reject-once";
};

export async function installAnvilWallet(
  page: Page,
  options: InstallAnvilWalletOptions = {},
) {
  await page.addInitScript(
    ({ rpcUrl, accounts, initialAccountIndex, connectMode, sendMode }) => {
      const listeners = new Map<
        string,
        Set<(...args: unknown[]) => void>
      >();
      let requestId = 1;
      const persistedAccountIndexValue = sessionStorage.getItem(
        "anvil-wallet-account-index",
      );
      const persistedAccountIndex =
        persistedAccountIndexValue === null
          ? Number.NaN
          : Number(persistedAccountIndexValue);
      let accountIndex =
        Number.isInteger(persistedAccountIndex) &&
        persistedAccountIndex >= 0 &&
        persistedAccountIndex < accounts.length
          ? persistedAccountIndex
          : initialAccountIndex;
      let authorized =
        sessionStorage.getItem("anvil-wallet-authorized") === "true";
      let rejectedSend = false;

      const emit = (event: string, ...args: unknown[]) => {
        for (const handler of listeners.get(event) ?? []) {
          handler(...args);
        }
      };

      const provider = {
        isMetaMask: true,
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }) => {
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_addEthereumChain") return null;
          if (method === "eth_accounts") {
            return authorized ? [accounts[accountIndex]] : [];
          }
          if (method === "eth_requestAccounts") {
            if (connectMode === "pending") {
              return new Promise(() => undefined);
            }
            authorized = true;
            sessionStorage.setItem("anvil-wallet-authorized", "true");
            emit("accountsChanged", [accounts[accountIndex]]);
            return [accounts[accountIndex]];
          }

          let requestParams = params ?? [];
          if (
            method === "eth_sendTransaction" &&
            requestParams[0] &&
            typeof requestParams[0] === "object"
          ) {
            if (sendMode === "reject-once" && !rejectedSend) {
              rejectedSend = true;
              throw new Error("User rejected the request.");
            }
            requestParams = [
              { ...requestParams[0], from: accounts[accountIndex] },
              ...requestParams.slice(1),
            ];
          }

          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: requestId++,
              method,
              params: requestParams,
            }),
          });
          const payload = (await response.json()) as {
            result?: unknown;
            error?: { message?: string };
          };
          if (payload.error) {
            throw new Error(payload.error.message ?? "Anvil RPC error");
          }
          return payload.result;
        },
        on: (event: string, handler: (...args: unknown[]) => void) => {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(handler);
          listeners.set(event, handlers);
        },
        removeListener: (
          event: string,
          handler: (...args: unknown[]) => void,
        ) => {
          listeners.get(event)?.delete(handler);
        },
        once: (event: string, handler: (...args: unknown[]) => void) => {
          const wrapped = (...args: unknown[]) => {
            listeners.get(event)?.delete(wrapped);
            handler(...args);
          };
          listeners.get(event)?.add(wrapped);
        },
      };

      Object.defineProperty(window, "ethereum", {
        configurable: true,
        value: provider,
      });
      Object.defineProperty(window, "__switchAnvilAccount", {
        configurable: true,
        value: (nextIndex: number) => {
          if (!accounts[nextIndex]) {
            throw new Error("Unknown test account index");
          }
          accountIndex = nextIndex;
          sessionStorage.setItem(
            "anvil-wallet-account-index",
            String(accountIndex),
          );
          if (authorized) {
            emit("accountsChanged", [accounts[accountIndex]]);
          }
        },
      });

      const detail = {
        info: {
          uuid: "4d595df4-0a53-4f45-a8f7-b8625a02e745",
          name: "MetaMask",
          icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' />",
          rdns: "io.metamask",
        },
        provider,
      };
      const announce = () => {
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail }),
        );
      };

      window.addEventListener("eip6963:requestProvider", announce);
      queueMicrotask(announce);
    },
    {
      rpcUrl: options.rpcUrl ?? ANVIL_RPC_URL,
      accounts: options.accounts ?? ANVIL_ACCOUNTS,
      initialAccountIndex: options.initialAccountIndex ?? 0,
      connectMode: options.connectMode ?? "standard",
      sendMode: options.sendMode ?? "standard",
    },
  );
}

export async function switchAnvilAccount(page: Page, accountIndex: number) {
  await page.evaluate((nextIndex) => {
    (
      window as Window & {
        __switchAnvilAccount?: (index: number) => void;
      }
    ).__switchAnvilAccount?.(nextIndex);
  }, accountIndex);
}
