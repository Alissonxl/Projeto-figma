export type SemanticType =
  | 'button'
  | 'card'
  | 'navbar'
  | 'sidebar'
  | 'header'
  | 'footer'
  | 'section'
  | 'form'
  | 'input'
  | 'image'
  | 'text'
  | 'list'
  | 'grid'
  | 'container'
  | 'unknown';

export type SmartConfidenceLevel = 'automatic' | 'probable' | 'suggestion' | 'unknown';

export interface DecisionEvidence {
  id: string;
  label: string;
  weight: number;
  matched: boolean;
  detail?: string;
}

export interface SemanticDecision {
  type: SemanticType;
  confidence: number;
  level: SmartConfidenceLevel;
  evidence: DecisionEvidence[];
}

export interface SmartLayout {
  display: 'flex' | 'grid' | 'block';
  direction?: 'row' | 'column';
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  position: 'flow' | 'absolute';
  width: number;
  height: number;
}

export interface SmartAppearance {
  background?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: number;
  opacity?: number;
  shadow?: string;
  fontSize?: number;
  fontWeight?: number;
}

export interface SmartNode {
  id: string;
  name: string;
  originalType: string;
  semanticType: SemanticType;
  confidence: number;
  confidenceLevel: SmartConfidenceLevel;
  evidence: DecisionEvidence[];
  layout: SmartLayout;
  appearance: SmartAppearance;
  structuralSignature: string;
  reusable: boolean;
  componentName?: string;
  children: SmartNode[];
}

export interface ComponentCandidate {
  signature: string;
  nodeIds: string[];
  nodeNames: string[];
  semanticType: SemanticType;
  componentName: string;
  confidence: number;
}

export interface RepetitionPattern {
  signature: string;
  nodeIds: string[];
  componentName: string;
  count: number;
  useDataMap: boolean;
  propCandidates: string[];
  confidence: number;
}

export interface VariantDifference {
  property: string;
  values: string[];
}

export interface VariantGroup {
  componentName: string;
  nodeIds: string[];
  variantNames: string[];
  differences: VariantDifference[];
  confidence: number;
}

export type TokenCategory = 'color' | 'spacing' | 'radius' | 'font-size' | 'font-weight' | 'shadow' | 'width';

export interface DesignTokenCandidate {
  category: TokenCategory;
  value: string;
  occurrences: number;
  suggestedName: string;
  suggestedUtility?: string;
  confidence: number;
}

export interface DesignLintIssue {
  severity: 'info' | 'warning';
  category: 'spacing' | 'radius' | 'color' | 'typography' | 'alignment' | 'size';
  nodeIds: string[];
  message: string;
  expected?: string;
  actual?: string;
}

export interface AccessibilityIssue {
  severity: 'info' | 'warning' | 'error';
  rule:
    | 'image-alt'
    | 'button-name'
    | 'input-label'
    | 'heading-order'
    | 'interactive-semantics'
    | 'target-size'
    | 'contrast';
  nodeId: string;
  message: string;
  autoFix?: string;
}

export interface SmartAnalysisResult {
  roots: SmartNode[];
  components: ComponentCandidate[];
  repetitions: RepetitionPattern[];
  variants: VariantGroup[];
  tokens: DesignTokenCandidate[];
  lint: DesignLintIssue[];
  accessibility: AccessibilityIssue[];
  debugLog: string[];
  warnings: string[];
  truncated: boolean;
}
