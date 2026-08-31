import type { ResponsiveCompareSettings, ResponsiveConfidenceLevel, ResponsiveNodeSnapshot } from '../types';

export interface MatchScore {
  confidence: number;
  reasons: string[];
}

function compatibleType(left: ResponsiveNodeSnapshot, right: ResponsiveNodeSnapshot): boolean {
  const containers = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION', 'COMPONENT_SET']);
  return left.type === right.type || (containers.has(left.type) && containers.has(right.type));
}

function overlap(left: readonly string[], right: readonly string[]): number {
  if (!left.length && !right.length) return 1;
  const a = new Set(left);
  const b = new Set(right);
  const common = [...a].filter((value) => b.has(value)).length;
  return common / Math.max(a.size, b.size, 1);
}

function pathRole(value: string): string {
  return value.split('/').slice(-2).join('/').replace(/:\d+$/g, '');
}

function proximity(left: number, right: number, tolerance: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0;
  return Math.max(0, 1 - Math.abs(left - right) / Math.max(tolerance, 0.001));
}

function nameSimilarity(left: string, right: string): number {
  if (!left && !right) return 0.5;
  if (left === right) return 1;
  return overlap(left.split(' ').filter(Boolean), right.split(' ').filter(Boolean));
}

export function scoreResponsiveMatch(
  base: ResponsiveNodeSnapshot,
  target: ResponsiveNodeSnapshot,
  settings: ResponsiveCompareSettings
): MatchScore {
  if (!compatibleType(base, target)) return { confidence: 0, reasons: ['incompatible-type'] };
  if (base.type === 'TEXT' && base.textHash && target.textHash && base.textHash !== target.textHash)
    return { confidence: 0.35, reasons: ['different-text-content'] };
  const reasons: string[] = [];
  const childSimilarity =
    (overlap(base.childTypes, target.childTypes) + overlap(base.childNames, target.childNames)) / 2;
  const countSimilarity =
    1 - Math.min(1, Math.abs(base.childCount - target.childCount) / Math.max(base.childCount, target.childCount, 1));
  const structure =
    base.structureHash === target.structureHash
      ? 1
      : (base.layout === target.layout ? 0.35 : 0) + childSimilarity * 0.45 + countSimilarity * 0.2;
  if (structure >= 0.8) reasons.push('similar-structure');
  if (base.structureHash === target.structureHash) reasons.push('same-structure-hash');

  const descendantText = overlap(base.descendantTextHashes, target.descendantTextHashes);
  const sameText = !!base.textHash && base.textHash === target.textHash;
  const noText =
    !base.textHash && !target.textHash && !base.descendantTextHashes.length && !target.descendantTextHashes.length;
  const content = sameText ? 1 : noText ? 0.75 : descendantText;
  if (sameText) reasons.push('same-text');
  else if (descendantText >= 0.5) reasons.push('shared-descendant-text');

  const type = base.type === target.type ? 1 : 0.55;
  reasons.push(base.type === target.type ? 'same-type' : 'compatible-container-type');

  const dimensionTolerance = Math.max(settings.geometryTolerance * 3, 0.08);
  const dimensions =
    (proximity(base.relativeWidth, target.relativeWidth, dimensionTolerance) +
      proximity(base.relativeHeight, target.relativeHeight, dimensionTolerance)) /
    2;
  const position =
    (proximity(base.relativeX, target.relativeX, settings.geometryTolerance * 2) +
      proximity(base.relativeY, target.relativeY, settings.geometryTolerance * 2)) /
    2;
  if (position >= 0.8) reasons.push('similar-relative-position');

  const style = base.renderHash === target.renderHash ? 1 : overlap(base.styleFamilies, target.styleFamilies);
  if (style >= 0.8) reasons.push('similar-style-families');
  const name = nameSimilarity(base.normalizedName, target.normalizedName);
  if (name === 1 && base.normalizedName) reasons.push('same-name');
  if (pathRole(base.path) === pathRole(target.path)) reasons.push('same-hierarchy-role');

  const score =
    structure * 0.3 + content * 0.2 + type * 0.15 + dimensions * 0.1 + position * 0.1 + style * 0.1 + name * 0.05;
  return { confidence: Number(Math.min(1, score).toFixed(3)), reasons };
}

export function confidenceLevel(value: number, exact = false): ResponsiveConfidenceLevel {
  if (exact && value >= 0.95) return 'exact';
  if (value >= 0.88) return 'safe';
  if (value >= 0.7) return 'suggestion';
  return 'review';
}
