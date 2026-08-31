import type { DecisionEvidence, SmartConfidenceLevel } from '../types';

export const CONFIDENCE_THRESHOLDS = Object.freeze({
  automatic: 0.9,
  probable: 0.75,
  suggestion: 0.55
});

export function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)).toFixed(3));
}

export function confidenceLevel(value: number): SmartConfidenceLevel {
  const normalized = clampConfidence(value);
  if (normalized >= CONFIDENCE_THRESHOLDS.automatic) return 'automatic';
  if (normalized >= CONFIDENCE_THRESHOLDS.probable) return 'probable';
  if (normalized >= CONFIDENCE_THRESHOLDS.suggestion) return 'suggestion';
  return 'unknown';
}

export function scoreEvidence(evidence: readonly DecisionEvidence[]): number {
  const valid = evidence.filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  const maximum = valid.reduce((sum, item) => sum + item.weight, 0);
  if (maximum === 0) return 0;
  const score = valid.reduce((sum, item) => sum + (item.matched ? item.weight : 0), 0) / maximum;
  return clampConfidence(score);
}

export function decisionLog(
  nodeName: string,
  type: string,
  confidence: number,
  evidence: readonly DecisionEvidence[]
): string {
  const lines = [
    `Node: ${nodeName}`,
    `Detected: ${type}`,
    `Confidence: ${clampConfidence(confidence).toFixed(2)}`,
    'Evidence:'
  ];
  for (const item of evidence)
    lines.push(`${item.matched ? '+' : '-'} ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
  return lines.join('\n');
}
