import type { Direction, NormalizedNode, SuggestedGroup } from '../types/layoutAnalysis';
import type { StructureAnalysisConfig } from './config';
import { clamp01, median } from './confidence';
import { analyzeSpacing, sortedOnAxis } from './spacingAnalyzer';
import { analyzeDirection } from './directionAnalyzer';
import { crossAxisAlignment } from './alignmentAnalyzer';
import { utility } from '../utils/tailwindScale';
import type { Settings } from '../types';

export function analyzeGroups(
  nodes: readonly NormalizedNode[],
  direction: Direction,
  config: StructureAnalysisConfig,
  settings: Settings
): SuggestedGroup[] {
  if (nodes.length < 3 || direction === 'unknown') return [];
  const ordered = sortedOnAxis(nodes, direction);
  const spacing = analyzeSpacing(ordered, direction, config.gapTolerancePx);
  const positive = spacing.gaps.filter((g) => g > 0);
  const base = median(positive);
  if (base <= 0) return [];
  const breaks = spacing.gaps.map((g, i) => (g > base * config.groupGapFactor ? i : -1)).filter((i) => i >= 0);
  if (!breaks.length) return [];
  const chunks: NormalizedNode[][] = [];
  let start = 0;
  for (const index of breaks) {
    chunks.push(ordered.slice(start, index + 1));
    start = index + 1;
  }
  chunks.push(ordered.slice(start));
  if (chunks.some((c) => c.length < 2)) return [];
  return chunks.flatMap((chunk, index) => {
    const dir = analyzeDirection(chunk, config.alignmentTolerancePx, config.directionScoreMargin);
    if (dir.direction === 'unknown' || dir.confidence < config.minimumConfidence) return [];
    const groupDirection = dir.direction;
    const gap = analyzeSpacing(chunk, groupDirection, config.gapTolerancePx);
    const align = crossAxisAlignment(chunk, groupDirection, config.alignmentTolerancePx);
    const classes = ['flex', groupDirection === 'column' ? 'flex-col' : 'flex-row'];
    if (align.className && align.confidence >= config.minimumConfidence) classes.push(align.className);
    if (gap.representative !== null && gap.confidence >= config.minimumConfidence)
      classes.push(utility('gap', gap.representative, settings));
    const separation = breaks.length
      ? Math.min(...breaks.map((i) => spacing.gaps[i]! / (base * config.groupGapFactor)))
      : 0;
    const evidence = [
      dir.confidence,
      gap.confidence,
      clamp01(separation),
      ...(align.className ? [align.confidence] : [])
    ];
    return [
      {
        name: `Grupo ${index + 1}`,
        nodeIds: chunk.map((n) => n.id),
        nodeNames: chunk.map((n) => n.name),
        suggestedClasses: classes,
        confidence: evidence.reduce((sum, value) => sum + value, 0) / evidence.length
      }
    ];
  });
}
