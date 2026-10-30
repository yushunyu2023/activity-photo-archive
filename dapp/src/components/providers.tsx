"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { KeyVaultProvider } from "@/components/key-vault-provider";
import { ToastProvider } from "@/components/toast-provider";
import { VaultDialog } from "@/components/vault-dialog";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <KeyVaultProvider>
            {children}
            <VaultDialog />
          </KeyVaultProvider>
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
