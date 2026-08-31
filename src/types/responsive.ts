export type FrameRole = 'base' | 'mobile' | 'tablet' | 'desktop' | 'custom' | 'unknown';
export type ResponsiveBreakpoint = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type ResponsiveConfidenceLevel = 'exact' | 'safe' | 'suggestion' | 'review';
export type ResponsiveSuggestionFidelity = 'exact' | 'equivalent' | 'suggestion' | 'review';
export type ResponsiveMatchSource = 'automatic' | 'manual';

export interface ResponsiveCompareSettings {
  enabled: boolean;
  preset: 'conservative' | 'balanced' | 'flexible' | 'custom';
  minimumMatchConfidence: number;
  minimumStructureSimilarity: number;
  geometryTolerance: number;
  percentageTolerance: number;
  autoBreakpointSuggestion: boolean;
  allowVisibilityInference: boolean;
  allowOrderInference: boolean;
  allowTypographyResponsive: boolean;
  allowHeuristicLayoutChanges: boolean;
}

export interface ResponsiveNodeSnapshot {
  id: string;
  frameId: string;
  name: string;
  normalizedName: string;
  type: string;
  parentId?: string;
  path: string;
  depth: number;
  width: number;
  height: number;
  relativeWidth: number;
  relativeHeight: number;
  x: number;
  y: number;
  relativeX: number;
  relativeY: number;
  visible: boolean;
  text?: string;
  textHash?: string;
  layout: 'none' | 'horizontal' | 'vertical' | 'grid';
  childCount: number;
  childTypes: string[];
  childNames: string[];
  descendantTextHashes: string[];
  styleFamilies: string[];
  structureHash: string;
  renderHash: string;
}

export interface ResponsiveFrameInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  aspectRatio: number;
  role: FrameRole;
  roleLabel: string;
  roleConfidence: number;
  breakpoint: ResponsiveBreakpoint;
  breakpointConfidence: number;
  isBase: boolean;
  nodeCount: number;
  truncated: boolean;
}

export interface ResponsiveNodeMatch {
  baseFrameId: string;
  targetFrameId: string;
  baseNodeId: string;
  targetNodeId: string;
  confidence: number;
  level: ResponsiveConfidenceLevel;
  reasons: string[];
  source: ResponsiveMatchSource;
}

export interface ResponsiveAmbiguousMatch {
  baseNodeId: string;
  targetFrameId: string;
  candidateNodeIds: string[];
  confidence: number;
  reason: string;
}

export interface ResponsiveUnmatchedNode {
  frameId: string;
  nodeId: string;
  name: string;
  type: string;
  side: 'base' | 'variant';
  reason: string;
}

export interface ResponsiveSuggestion {
  id: string;
  baseNodeId: string;
  targetNodeId: string;
  targetFrameId: string;
  nodeName: string;
  property: string;
  baseValue: string;
  targetValue: string;
  breakpoint: Exclude<ResponsiveBreakpoint, 'base'>;
  classes: string[];
  confidence: number;
  level: ResponsiveConfidenceLevel;
  fidelity: ResponsiveSuggestionFidelity;
  source: string;
  applied: boolean;
  note?: string;
}

export interface ResponsiveComparisonSummary {
  differences: number;
  exact: number;
  safe: number;
  suggestions: number;
  review: number;
  matched: number;
  unmatchedBase: number;
  unmatchedVariants: number;
  ambiguous: number;
}

export interface ResponsiveBudgetResult {
  framesAnalyzed: number;
  nodesAnalyzed: number;
  matchesEvaluated: number;
  truncated: boolean;
  reasons: string[];
}

export interface ResponsiveCompareResult {
  eligible: boolean;
  generated: boolean;
  blockedReason?: string;
  baseFrameId?: string;
  frames: ResponsiveFrameInfo[];
  structureSimilarity: number;
  matches: ResponsiveNodeMatch[];
  ambiguous: ResponsiveAmbiguousMatch[];
  unmatched: ResponsiveUnmatchedNode[];
  suggestions: ResponsiveSuggestion[];
  summary: ResponsiveComparisonSummary;
  budget: ResponsiveBudgetResult;
  mergedNode?: import('./index').ParsedNode;
  notes: string[];
}

export interface ResponsiveManualMatch {
  targetFrameId: string;
  baseNodeId: string;
  targetNodeId: string;
}

export interface ResponsiveCompareOverrides {
  baseFrameId?: string;
  breakpoints?: Readonly<Record<string, ResponsiveBreakpoint>>;
  roles?: Readonly<Record<string, FrameRole>>;
  manualMatches?: readonly ResponsiveManualMatch[];
}
