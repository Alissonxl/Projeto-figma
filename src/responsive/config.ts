import type { ResponsiveCompareSettings } from '../types';

export const RESPONSIVE_LIMITS = {
  maxFrames: 5,
  maxNodesPerFrame: 500,
  maxMatches: 500,
  maxComparisonDepth: 4,
  maxCandidatesPerNode: 24
} as const;

export const RESPONSIVE_PRESETS: Readonly<
  Record<'conservative' | 'balanced' | 'flexible', Partial<ResponsiveCompareSettings>>
> = {
  conservative: {
    minimumMatchConfidence: 0.88,
    minimumStructureSimilarity: 0.75,
    geometryTolerance: 0.035,
    percentageTolerance: 0.01,
    allowVisibilityInference: false,
    allowOrderInference: true,
    allowTypographyResponsive: true,
    allowHeuristicLayoutChanges: false
  },
  balanced: {
    minimumMatchConfidence: 0.8,
    minimumStructureSimilarity: 0.65,
    geometryTolerance: 0.05,
    percentageTolerance: 0.015,
    allowVisibilityInference: true,
    allowOrderInference: true,
    allowTypographyResponsive: true,
    allowHeuristicLayoutChanges: false
  },
  flexible: {
    minimumMatchConfidence: 0.7,
    minimumStructureSimilarity: 0.55,
    geometryTolerance: 0.08,
    percentageTolerance: 0.025,
    allowVisibilityInference: true,
    allowOrderInference: true,
    allowTypographyResponsive: true,
    allowHeuristicLayoutChanges: true
  }
};
