export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export function closeness(delta: number, tolerance: number): number {
  return clamp01(1 - delta / Math.max(tolerance, 1));
}
export function average(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
