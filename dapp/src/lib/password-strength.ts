import type { Address } from "viem";

const COMMON_PASSWORDS = new Set([
  "123456789012",
  "password1234",
  "qwertyuiop12",
  "activityarchive",
  "activityphoto",
  "letmein123456",
  "welcome123456",
]);

const SEQUENCES = [
  "0123456789",
  "9876543210",
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "qwertyuiop",
  "poiuytrewq",
  "asdfghjkl",
  "lkjhgfdsa",
];

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "很弱" | "较弱" | "一般" | "强" | "很强";
  issues: string[];
  acceptable: boolean;
};

function hasSequence(value: string): boolean {
  return SEQUENCES.some((sequence) =>
    Array.from({ length: Math.max(0, sequence.length - 3) }, (_, index) =>
      sequence.slice(index, index + 4),
    ).some((fragment) => value.includes(fragment)),
  );
}

export function evaluateAccountPassword(
  password: string,
  context: { address?: Address; walletAddress?: Address; activityName?: string } = {},
): PasswordStrength {
  const normalized = password.normalize("NFC");
  const length = Array.from(normalized).length;
  const issues: string[] = [];

  if (length < 12) issues.push("至少输入 12 个字符");
  if (length > 128) issues.push("最多输入 128 个字符");
  if (/^\d+$/.test(normalized)) issues.push("不要只使用数字");
  if (/^(.)\1+$/u.test(normalized)) issues.push("不要重复同一个字符");
  if (COMMON_PASSWORDS.has(normalized.toLowerCase())) issues.push("该密码过于常见");
  if (hasSequence(normalized.toLowerCase())) issues.push("避免键盘或字母连续序列");

  const address = context.walletAddress ?? context.address;
  if (
    address &&
    Array.from({ length: 8 }, (_, index) =>
      address.slice(2 + index, 10 + index).toLowerCase(),
    ).some((fragment) => fragment.length === 8 && normalized.toLowerCase().includes(fragment))
  ) {
    issues.push("不要包含钱包地址片段");
  }
  if (/activity\s*archive|活动相册/i.test(normalized)) {
    issues.push("不要包含产品名称");
  }
  if (
    context.activityName &&
    context.activityName.trim().length >= 2 &&
    normalized.toLowerCase().includes(context.activityName.trim().toLowerCase())
  ) {
    issues.push("不要包含活动名称");
  }

  const groups = [
    /[a-z]/.test(normalized),
    /[A-Z]/.test(normalized),
    /\d/.test(normalized),
    /[^\p{L}\p{N}]/u.test(normalized),
  ].filter(Boolean).length;
  const uniqueRatio = new Set(Array.from(normalized)).size / Math.max(length, 1);

  let score = 0;
  if (length >= 12) score += 1;
  if (length >= 16) score += 1;
  if (length >= 24) score += 1;
  if (groups >= 3) score += 1;
  if (uniqueRatio >= 0.6) score += 1;
  if (issues.length) score = Math.min(score, 2);

  const boundedScore = Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ["很弱", "较弱", "一般", "强", "很强"] as const;
  return {
    score: boundedScore,
    label: labels[boundedScore],
    issues,
    acceptable: issues.length === 0 && boundedScore >= 3,
  };
}
