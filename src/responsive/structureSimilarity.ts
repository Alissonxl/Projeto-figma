import type { ResponsiveNodeMatch } from '../types';
import type { ResponsiveFrameSnapshot } from './responsiveSnapshot';

function textHashes(frame: ResponsiveFrameSnapshot): Set<string> {
  return new Set(frame.nodes.map((node) => node.textHash).filter((value): value is string => !!value));
}

export function responsiveStructureSimilarity(
  base: ResponsiveFrameSnapshot,
  target: ResponsiveFrameSnapshot,
  matches: readonly ResponsiveNodeMatch[]
): number {
  const matched = Math.max(0, matches.length - 1);
  const comparable = Math.max(base.nodes.length - 1, target.nodes.length - 1, 1);
  const coverage = matched / comparable;
  const baseTexts = textHashes(base);
  const targetTexts = textHashes(target);
  const commonTexts = [...baseTexts].filter((value) => targetTexts.has(value)).length;
  const textSimilarity = commonTexts / Math.max(baseTexts.size, targetTexts.size, 1);
  const layoutSimilarity = base.nodes[0]?.layout === target.nodes[0]?.layout ? 1 : 0.6;
  return Number(Math.min(1, coverage * 0.75 + textSimilarity * 0.15 + layoutSimilarity * 0.1).toFixed(3));
}
