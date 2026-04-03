export function calculateQER(qaMinutes: number, draftMinutes: number) {
  return draftMinutes > 0 ? (qaMinutes / draftMinutes) * 100 : 0;
}
