export type LayoutType = 'flex' | 'grid' | 'unknown';
export type Direction = 'row' | 'column' | 'unknown';
export type AnalysisSource = 'auto-layout' | 'heuristic';

export type NormalizedGridTrack = { type: 'FLEX'; value: number } | { type: 'FIXED'; value: number } | { type: 'HUG' };

export interface NormalizedGridAxis {
  count: number;
  tracks: NormalizedGridTrack[];
  supported: boolean;
  reason?: string;
}

export interface NormalizedGridLayout {
  columns: NormalizedGridAxis;
  rows: NormalizedGridAxis;
  columnGap: number;
  rowGap: number;
}

export interface NormalizedGridPlacement {
  columnStart: number;
  rowStart: number;
  columnSpan: number;
  rowSpan: number;
}

export interface NormalizedNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  visible: boolean;
  absolute: boolean;
  rotated: boolean;
  gridPlacement?: NormalizedGridPlacement;
}
export interface StructureInput extends NormalizedNode {
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  primaryAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' | undefined;
  counterAxisAlignItems: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE' | undefined;
  itemSpacing: number | undefined;
  counterAxisSpacing: number | undefined;
  layoutWrap: 'NO_WRAP' | 'WRAP' | undefined;
  children: NormalizedNode[];
  grid: NormalizedGridLayout | undefined;
  inferredLayout?: boolean;
}
export interface SuggestedGroup {
  name: string;
  nodeIds: string[];
  nodeNames: string[];
  suggestedClasses: string[];
  confidence: number;
}
export type StructureSuggestion = SuggestedGroup;
export interface LayoutAnalysis {
  nodeId: string;
  nodeName: string;
  type: LayoutType;
  direction: Direction;
  classes: string[];
  confidence: number;
  source: AnalysisSource;
  message: string;
  groups: SuggestedGroup[];
  classEvidence?: Array<{
    className: string;
    source: AnalysisSource;
    confidence: number;
    fidelity: 'exact' | 'suggestion';
  }>;
}
