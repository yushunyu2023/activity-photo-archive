import { NextRequest, NextResponse } from "next/server";

const CONTENT_SECURITY_POLICY = "Content-Security-Policy";

function createNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

function getConfiguredRpcOrigin() {
  const configuredRpcUrl = process.env.NEXT_PUBLIC_LOCAL_RPC_URL;
  if (!configuredRpcUrl) return null;

  try {
    const url = new URL(configuredRpcUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function buildContentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const configuredRpcOrigin = getConfiguredRpcOrigin();
  const rpcOrigins = [
    "http://127.0.0.1:8545",
    "http://localhost:8545",
    ...(configuredRpcOrigin ? [configuredRpcOrigin] : []),
  ];
  const connectSources = [
    "'self'",
    "https:",
    "wss:",
    ...new Set(rpcOrigins),
  ];

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CONTENT_SECURITY_POLICY, contentSecurityPolicy);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(CONTENT_SECURITY_POLICY, contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
};
