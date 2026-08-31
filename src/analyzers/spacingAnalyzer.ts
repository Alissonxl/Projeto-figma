import type { Direction, NormalizedNode } from '../types/layoutAnalysis';
import { average, clamp01, median } from './confidence';

export interface SpacingAnalysis {
  gaps: number[];
  representative: number | null;
  confidence: number;
}
export function axisGap(a: NormalizedNode, b: NormalizedNode, direction: Direction): number {
  return direction === 'row' ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
}
export function sortedOnAxis(nodes: readonly NormalizedNode[], direction: Direction): NormalizedNode[] {
  return [...nodes].sort((a, b) => (direction === 'row' ? a.x - b.x : a.y - b.y));
}
export function analyzeSpacing(
  nodes: readonly NormalizedNode[],
  direction: Direction,
  tolerance: number
): SpacingAnalysis {
  if (direction === 'unknown' || nodes.length < 2) return { gaps: [], representative: null, confidence: 0 };
  const ordered = sortedOnAxis(nodes, direction);
  const gaps = ordered.slice(1).map((node, i) => axisGap(ordered[i]!, node, direction));
  if (gaps.some((g) => g < 0)) return { gaps, representative: null, confidence: 0 };
  const value = median(gaps);
  const deviation = average(gaps.map((g) => Math.abs(g - value)));
  const confidence = clamp01(1 - deviation / Math.max(tolerance, value * 0.2, 1));
  return { gaps, representative: confidence >= 0.75 ? Number(value.toFixed(3)) : null, confidence };
}
