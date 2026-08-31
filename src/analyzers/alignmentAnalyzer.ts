import type { Direction, NormalizedNode } from '../types/layoutAnalysis';
import { average, clamp01 } from './confidence';
export function crossAxisAlignment(
  nodes: readonly NormalizedNode[],
  direction: Direction,
  tolerance: number
): { className: string | null; confidence: number } {
  if (nodes.length < 2 || direction === 'unknown') return { className: null, confidence: 0 };
  const values = nodes.map((n) => (direction === 'row' ? n.centerY : n.centerX));
  const mean = average(values);
  const confidence = average(values.map((v) => clamp01(1 - Math.abs(v - mean) / Math.max(tolerance, 1))));
  return { className: confidence >= 0.75 ? 'items-center' : null, confidence };
}
