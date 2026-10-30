export const MAX_ACTIVITY_NAME_CHARACTERS = 20;

export function countActivityNameCharacters(value: string): number {
  return Array.from(value).length;
}

export function normalizeActivityName(value: string): string {
  return value.trim();
}

export function validateActivityName(value: string): string | null {
  const normalized = normalizeActivityName(value);
  const characterCount = countActivityNameCharacters(normalized);

  if (!normalized) return "请输入活动名称";
  if (characterCount > MAX_ACTIVITY_NAME_CHARACTERS) {
    return `活动名称不能超过 ${MAX_ACTIVITY_NAME_CHARACTERS} 个字符`;
  }
  if (/\p{Cc}/u.test(normalized)) {
    return "活动名称不能包含换行或控制字符";
  }
  return null;
}
