import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors/coinbaseWallet";
import { injected } from "wagmi/connectors/injected";
import { walletConnect } from "wagmi/connectors/walletConnect";
import { base, baseSepolia } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const localAnvil = defineChain({
  id: 31_337,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545"],
    },
  },
  testnet: true,
});

const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? baseSepolia.id);

export const TARGET_CHAIN =
  configuredChainId === base.id
    ? base
    : configuredChainId === localAnvil.id
      ? localAnvil
      : baseSepolia;
export const TARGET_CHAIN_ID = TARGET_CHAIN.id;

const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet({
    appName: "Activity Archive",
    appLogoUrl: undefined,
    preference: { options: "all" },
  }),
  ...(projectId
    ? [
        walletConnect({
          projectId,
          showQrModal: true,
          metadata: {
            name: "Activity Archive",
            description: "Private activity photo archive on Base",
            url: "https://activity-archive.local",
            icons: [],
          },
        }),
      ]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [baseSepolia, base, localAnvil],
  connectors,
  transports: {
    [baseSepolia.id]: http(),
    [base.id]: http(),
    [localAnvil.id]: http(
      process.env.NEXT_PUBLIC_LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    ),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
