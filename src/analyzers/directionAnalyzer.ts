import type { Direction, NormalizedNode } from '../types/layoutAnalysis';
import { average, clamp01 } from './confidence';
import { sortedOnAxis } from './spacingAnalyzer';

export interface DirectionAnalysis {
  direction: Direction;
  confidence: number;
  horizontal: number;
  vertical: number;
}
function score(nodes: readonly NormalizedNode[], direction: 'row' | 'column', tolerance: number): number {
  if (nodes.length < 2) return 0;
  const centers = nodes.map((n) => (direction === 'row' ? n.centerY : n.centerX));
  const mean = average(centers);
  const alignment = average(centers.map((c) => clamp01(1 - Math.abs(c - mean) / Math.max(tolerance, 1))));
  const ordered = sortedOnAxis(nodes, direction);
  const nonOverlap =
    ordered
      .slice(1)
      .filter((n, i) =>
        direction === 'row' ? n.x >= ordered[i]!.x + ordered[i]!.width : n.y >= ordered[i]!.y + ordered[i]!.height
      ).length /
    (ordered.length - 1);
  return clamp01(alignment * 0.75 + nonOverlap * 0.25);
}
export function analyzeDirection(
  nodes: readonly NormalizedNode[],
  tolerance: number,
  minimumMargin = 0
): DirectionAnalysis {
  const horizontal = score(nodes, 'row', tolerance),
    vertical = score(nodes, 'column', tolerance);
  const best = Math.max(horizontal, vertical);
  const ambiguous = Math.abs(horizontal - vertical) < minimumMargin;
  return {
    direction: best < 0.55 || ambiguous ? 'unknown' : horizontal >= vertical ? 'row' : 'column',
    confidence: ambiguous ? best * Math.max(0, Math.abs(horizontal - vertical) / Math.max(minimumMargin, 0.001)) : best,
    horizontal,
    vertical
  };
}
