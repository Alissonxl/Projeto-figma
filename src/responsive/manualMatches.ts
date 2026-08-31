import type { ResponsiveManualMatch } from '../types';

export function upsertManualMatch(
  values: readonly ResponsiveManualMatch[],
  next: ResponsiveManualMatch
): ResponsiveManualMatch[] {
  return [
    ...values.filter(
      (item) =>
        item.targetFrameId !== next.targetFrameId ||
        (item.baseNodeId !== next.baseNodeId && item.targetNodeId !== next.targetNodeId)
    ),
    next
  ];
}

export function removeManualMatch(
  values: readonly ResponsiveManualMatch[],
  targetFrameId: string,
  baseNodeId: string
): ResponsiveManualMatch[] {
  return values.filter((item) => item.targetFrameId !== targetFrameId || item.baseNodeId !== baseNodeId);
}
