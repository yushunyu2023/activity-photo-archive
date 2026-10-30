import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Activity Archive",
  description: "Private, permanent activity photo archive on Base and Arweave",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Nonce-based CSP requires request-time rendering so Next.js can attach the nonce.
  await connection();
  const storageMode = process.env.ARWEAVE_UPLOAD_ENDPOINT ? "arweave" : "local";

  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>
        <Providers>
          <AppShell storageMode={storageMode}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
