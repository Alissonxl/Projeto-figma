import type { Direction, NormalizedNode } from '../types/layoutAnalysis';
import type { StructureAnalysisConfig } from './config';
import { clamp01, median } from './confidence';
import { analyzeSpacing, sortedOnAxis } from './spacingAnalyzer';
export function analyzeJustifyBetween(
  container: NormalizedNode,
  nodes: readonly NormalizedNode[],
  direction: Direction,
  config: StructureAnalysisConfig
): number {
  if (nodes.length < 2 || direction === 'unknown') return 0;
  const ordered = sortedOnAxis(nodes, direction);
  const first = ordered[0]!,
    last = ordered[ordered.length - 1]!;
  const start = direction === 'row' ? first.x - container.x : first.y - container.y;
  const end =
    direction === 'row'
      ? container.x + container.width - (last.x + last.width)
      : container.y + container.height - (last.y + last.height);
  const spacing = analyzeSpacing(ordered, direction, config.gapTolerancePx);
  const positive = spacing.gaps.filter((g) => g > 0);
  if (!positive.length) return 0;
  const typical = median(positive),
    largest = Math.max(...positive);
  const edges = clamp01(1 - (Math.abs(start) + Math.abs(end)) / (config.edgeTolerancePx * 2));
  const separation = typical > 0 ? clamp01(largest / (typical * config.groupGapFactor)) : 0;
  return clamp01(edges * 0.55 + separation * 0.45);
}
