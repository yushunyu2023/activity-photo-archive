const MAX_UINT256 = (1n << 256n) - 1n;

export function isValidActivityId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;

  try {
    return BigInt(value) <= MAX_UINT256;
  } catch {
    return false;
  }
}
