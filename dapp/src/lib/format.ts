import type { Address } from "viem";

export function shortAddress(address?: Address | string): string {
  if (!address) return "未连接";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function shortHash(hash?: string): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function formatUnixDate(timestamp: bigint | number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(timestamp) * 1000));
}

export function toDateTimeLocalValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function dateTimeLocalToUnix(value: string): bigint {
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) throw new Error("时间格式不正确");
  return BigInt(Math.floor(milliseconds / 1000));
}

export function formatEthFee(value?: bigint): string {
  if (value === undefined) return "待估算";
  const eth = Number(value) / 1e18;
  return `${eth.toFixed(6)} ETH`;
}
