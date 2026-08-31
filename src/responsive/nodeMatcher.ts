import type {
  ResponsiveAmbiguousMatch,
  ResponsiveCompareSettings,
  ResponsiveManualMatch,
  ResponsiveNodeMatch,
  ResponsiveNodeSnapshot,
  ResponsiveUnmatchedNode
} from '../types';
import { RESPONSIVE_LIMITS } from './config';
import { confidenceLevel, scoreResponsiveMatch } from './matchScoring';
import type { ResponsiveBudget } from './responsiveBudget';
import type { ResponsiveFrameSnapshot } from './responsiveSnapshot';

export interface FrameMatchResult {
  targetFrameId: string;
  matches: ResponsiveNodeMatch[];
  ambiguous: ResponsiveAmbiguousMatch[];
  unmatched: ResponsiveUnmatchedNode[];
  matchedTargetIds: Set<string>;
}

interface CandidateIndex {
  byName: Map<string, ResponsiveNodeSnapshot[]>;
  byType: Map<string, ResponsiveNodeSnapshot[]>;
  byText: Map<string, ResponsiveNodeSnapshot[]>;
  byStructure: Map<string, ResponsiveNodeSnapshot[]>;
  byPath: Map<string, ResponsiveNodeSnapshot[]>;
}

function add(
  index: Map<string, ResponsiveNodeSnapshot[]>,
  key: string | undefined,
  node: ResponsiveNodeSnapshot
): void {
  if (!key) return;
  const items = index.get(key) ?? [];
  items.push(node);
  index.set(key, items);
}

function pathSignature(node: ResponsiveNodeSnapshot): string {
  return node.path
    .split('/')
    .slice(-3)
    .map((part) => part.split(':')[0])
    .join('/');
}

function candidateIndex(nodes: readonly ResponsiveNodeSnapshot[]): CandidateIndex {
  const result: CandidateIndex = {
    byName: new Map(),
    byType: new Map(),
    byText: new Map(),
    byStructure: new Map(),
    byPath: new Map()
  };
  for (const node of nodes) {
    add(result.byName, node.normalizedName, node);
    add(result.byType, node.type, node);
    add(result.byText, node.textHash, node);
    add(result.byStructure, node.structureHash, node);
    add(result.byPath, pathSignature(node), node);
  }
  return result;
}

function candidatesFor(
  base: ResponsiveNodeSnapshot,
  targetParentId: string,
  target: ResponsiveFrameSnapshot,
  index: CandidateIndex,
  used: ReadonlySet<string>
): ResponsiveNodeSnapshot[] {
  const hierarchical = target.childrenByParent.get(targetParentId) ?? [];
  const pool = new Map<string, ResponsiveNodeSnapshot>();
  const buckets = [
    base.textHash ? index.byText.get(base.textHash) : undefined,
    base.normalizedName ? index.byName.get(base.normalizedName) : undefined,
    index.byStructure.get(base.structureHash),
    index.byPath.get(pathSignature(base)),
    index.byType.get(base.type),
    hierarchical
  ]
    .filter((items): items is ResponsiveNodeSnapshot[] => !!items?.length)
    .sort((left, right) => left.length - right.length);
  for (const items of buckets) {
    for (const item of items) {
      if (!used.has(item.id) && item.parentId === targetParentId) pool.set(item.id, item);
      if (pool.size >= RESPONSIVE_LIMITS.maxCandidatesPerNode) break;
    }
    if (pool.size >= RESPONSIVE_LIMITS.maxCandidatesPerNode) break;
  }
  return [...pool.values()];
}

function manualFor(
  manual: readonly ResponsiveManualMatch[],
  baseNodeId: string,
  targetFrameId: string
): ResponsiveManualMatch | undefined {
  return manual.find((item) => item.baseNodeId === baseNodeId && item.targetFrameId === targetFrameId);
}

export function matchResponsiveFrame(
  base: ResponsiveFrameSnapshot,
  target: ResponsiveFrameSnapshot,
  settings: ResponsiveCompareSettings,
  budget: ResponsiveBudget,
  manualMatches: readonly ResponsiveManualMatch[] = []
): FrameMatchResult {
  const matches: ResponsiveNodeMatch[] = [];
  const ambiguous: ResponsiveAmbiguousMatch[] = [];
  const unmatched: ResponsiveUnmatchedNode[] = [];
  const usedTarget = new Set<string>([target.frame.id]);
  const index = candidateIndex(target.nodes);
  const rootMatch: ResponsiveNodeMatch = {
    baseFrameId: base.frame.id,
    targetFrameId: target.frame.id,
    baseNodeId: base.frame.id,
    targetNodeId: target.frame.id,
    confidence: 1,
    level: 'exact',
    reasons: ['root-frame'],
    source: 'automatic'
  };
  matches.push(rootMatch);
  const queue: { baseParentId: string; targetParentId: string }[] = [
    { baseParentId: base.frame.id, targetParentId: target.frame.id }
  ];

  while (queue.length) {
    const pair = queue.shift()!;
    const baseChildren = base.childrenByParent.get(pair.baseParentId) ?? [];
    for (const baseNode of baseChildren) {
      const manual = manualFor(manualMatches, baseNode.id, target.frame.id);
      if (manual) {
        const targetNode = target.byId.get(manual.targetNodeId);
        if (targetNode && !usedTarget.has(targetNode.id) && budget.tryMatch()) {
          const match: ResponsiveNodeMatch = {
            baseFrameId: base.frame.id,
            targetFrameId: target.frame.id,
            baseNodeId: baseNode.id,
            targetNodeId: targetNode.id,
            confidence: 1,
            level: 'exact',
            reasons: ['manual-link'],
            source: 'manual'
          };
          matches.push(match);
          usedTarget.add(targetNode.id);
          queue.push({ baseParentId: baseNode.id, targetParentId: targetNode.id });
          continue;
        }
      }
      const scored = candidatesFor(baseNode, pair.targetParentId, target, index, usedTarget)
        .map((candidate) => {
          const score = scoreResponsiveMatch(baseNode, candidate, settings);
          return {
            candidate,
            confidence: Number(Math.min(1, score.confidence + (score.confidence > 0.2 ? 0.15 : 0)).toFixed(3)),
            reasons: score.confidence > 0.2 ? [...score.reasons, 'same-parent-role'] : score.reasons
          };
        })
        .sort(
          (left, right) => right.confidence - left.confidence || left.candidate.id.localeCompare(right.candidate.id)
        );
      const best = scored[0];
      const second = scored[1];
      const ambiguityFloor = Math.max(0.5, settings.minimumMatchConfidence - 0.2);
      if (best && second && best.confidence >= ambiguityFloor && best.confidence - second.confidence < 0.06) {
        ambiguous.push({
          baseNodeId: baseNode.id,
          targetFrameId: target.frame.id,
          candidateNodeIds: scored.slice(0, 3).map((item) => item.candidate.id),
          confidence: best.confidence,
          reason: 'Dois ou mais candidatos possuem scores próximos.'
        });
        continue;
      }
      if (!best || best.confidence < settings.minimumMatchConfidence) {
        unmatched.push({
          frameId: base.frame.id,
          nodeId: baseNode.id,
          name: baseNode.name,
          type: baseNode.type,
          side: 'base',
          reason: best ? `Melhor confiança ${Math.round(best.confidence * 100)}% abaixo do limite.` : 'Sem candidato.'
        });
        continue;
      }
      if (!budget.tryMatch()) break;
      const match: ResponsiveNodeMatch = {
        baseFrameId: base.frame.id,
        targetFrameId: target.frame.id,
        baseNodeId: baseNode.id,
        targetNodeId: best.candidate.id,
        confidence: best.confidence,
        level: confidenceLevel(best.confidence, best.reasons.includes('same-text')),
        reasons: best.reasons,
        source: 'automatic'
      };
      matches.push(match);
      usedTarget.add(best.candidate.id);
      queue.push({ baseParentId: baseNode.id, targetParentId: best.candidate.id });
    }
  }

  for (const node of target.nodes) {
    if (node.id === target.frame.id || usedTarget.has(node.id)) continue;
    unmatched.push({
      frameId: target.frame.id,
      nodeId: node.id,
      name: node.name,
      type: node.type,
      side: 'variant',
      reason: 'Nenhum node equivalente foi confirmado no Frame base.'
    });
  }
  return { targetFrameId: target.frame.id, matches, ambiguous, unmatched, matchedTargetIds: usedTarget };
}
