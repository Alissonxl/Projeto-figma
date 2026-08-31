import type { LayoutAnalysis } from './layoutAnalysis';
import type { ResponsiveCompareSettings } from './responsive';
export * from './responsive';
export * from './smart';

export type Category =
  | 'layout'
  | 'position'
  | 'display'
  | 'flex'
  | 'grid'
  | 'dimensions'
  | 'spacing'
  | 'typography'
  | 'background'
  | 'border'
  | 'effects'
  | 'misc';
export type OutputProfile = 'faithful' | 'optimized';
export type ConversionFidelity =
  'exact' | 'equivalent' | 'arbitrary' | 'approximation' | 'ignored' | 'unsupported' | 'suggestion';

export interface Settings {
  preferDefaults: boolean;
  useRem: boolean;
  colorFormat: 'hex' | 'rgb' | 'tailwind';
  ignoreAutomaticTextDimensions: boolean;
  alignmentTolerancePx: number;
  gapTolerancePx: number;
  groupGapFactor: number;
  minimumStructureConfidence: number;
  outputProfile: OutputProfile;
  tailwindVersion: '3' | '4';
  defaultFontFamily: string;
  tokenMappings: string;
  smartDebug: boolean;
  responsiveCompare: ResponsiveCompareSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  preferDefaults: true,
  useRem: false,
  colorFormat: 'tailwind',
  ignoreAutomaticTextDimensions: true,
  alignmentTolerancePx: 8,
  gapTolerancePx: 4,
  groupGapFactor: 2.5,
  minimumStructureConfidence: 0.75,
  outputProfile: 'optimized',
  tailwindVersion: '4',
  defaultFontFamily: '',
  tokenMappings: '',
  smartDebug: false,
  responsiveCompare: {
    enabled: true,
    preset: 'balanced',
    minimumMatchConfidence: 0.8,
    minimumStructureSimilarity: 0.65,
    geometryTolerance: 0.05,
    percentageTolerance: 0.015,
    autoBreakpointSuggestion: true,
    allowVisibilityInference: true,
    allowOrderInference: true,
    allowTypographyResponsive: true,
    allowHeuristicLayoutChanges: false
  }
};

export interface Conversion {
  category: Category;
  property: string;
  value: string;
  classes: string[];
  source?: Readonly<Record<string, string | number>>;
  note?: string;
  fidelity?: ConversionFidelity;
  utility?: Readonly<{ name: string; value: string | number; className: string }>;
}

export interface TextSegmentInfo {
  text: string;
  start?: number;
  end?: number;
  classes?: string[];
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  lineHeight?: string;
  letterSpacing?: string;
  decoration?: string;
  textCase?: string;
}

export type PanelCategory =
  'layout' | 'dimensions' | 'spacing' | 'typography' | 'colors' | 'borders' | 'effects' | 'positioning' | 'other';

export interface ClassGroup {
  category: PanelCategory;
  label: string;
  classes: string[];
  conversions: Conversion[];
}
export type ConversionGroup = ClassGroup;
export type UnsupportedProperty = string;
export interface PreviewResult {
  requestId: number;
  nodeId: string;
  dataUrl?: string;
}

export type CodegenLayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
export type CodegenImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE';
export type CodegenImageUsage = 'background' | 'image-element' | 'unknown';
export type CodegenDimensionMode = 'auto' | 'fixed' | 'fill' | 'stretch';
export interface CodegenHyperlink {
  type: 'URL' | 'NODE';
  value: string;
}
export interface CodegenTextList {
  type: 'ORDERED' | 'UNORDERED';
  items: CodegenTextListItem[];
  hanging?: boolean;
}

export interface CodegenTextListItem {
  text: string;
  type: 'ORDERED' | 'UNORDERED';
  indentationLevel: number;
  itemSpacing: number;
}

export interface NodeCodegenMetadata {
  parentId?: string;
  parentWidth?: number;
  parentHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible?: boolean;
  rotation: number;
  layoutMode: CodegenLayoutMode;
  widthMode?: CodegenDimensionMode;
  heightMode?: CodegenDimensionMode;
  clipsContent?: boolean;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  text?: string;
  textTruncated?: boolean;
  hyperlink?: CodegenHyperlink;
  textList?: CodegenTextList;
  textListIssue?: 'mixed' | 'partial';
  imageScaleMode?: CodegenImageScaleMode;
  imageUsage?: CodegenImageUsage;
  ambiguousImagePaint?: boolean;
  complexTransform?: boolean;
  reverseZIndex?: boolean;
}

export interface ParsedNode {
  id: string;
  name: string;
  type: string;
  dimensions: string;
  classes: string[];
  conversions: Conversion[];
  groups: ClassGroup[];
  unsupported: string[];
  children: ParsedNode[];
  isVector: boolean;
  structure: LayoutAnalysis | null;
  analysisLimited: boolean;
  suggestions?: string[];
  textSegments?: TextSegmentInfo[];
  previewDataUrl?: string;
  detailsLoaded?: boolean;
  parseError?: string;
  codegen?: NodeCodegenMetadata;
}

export interface AnalysisSummary {
  partial: boolean;
  analyzed: number;
  skipped: number;
  truncatedDepth?: number;
  reason?: 'performance-limit' | 'root-limit' | 'payload-limit';
}

export type PluginMessage =
  | { type: 'selection-pending'; requestId: number }
  | { type: 'selection'; requestId: number; nodes: ParsedNode[]; analysis: AnalysisSummary; error?: string }
  | {
      type: 'node-details';
      requestId: number;
      nodeId: string;
      node?: ParsedNode;
      analysis?: AnalysisSummary;
      error?: string;
    }
  | { type: 'settings'; settings: Settings }
  | { type: 'preview'; requestId: number; nodeId: string; dataUrl?: string }
  | { type: 'notice'; message: string };

export type UiMessage =
  | { type: 'refresh' }
  | { type: 'resize'; height: number }
  | { type: 'save-settings'; settings: Settings }
  | { type: 'request-preview'; requestId: number; nodeId: string }
  | { type: 'request-node-details'; requestId: number; nodeId: string }
  | { type: 'request-selection-details'; requestId: number; nodeIds: string[] }
  | { type: 'reset-settings' };
