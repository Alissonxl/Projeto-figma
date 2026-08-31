import type { ParsedNode, SmartAnalysisResult, SmartNode } from '../types';
import { analyzeAccessibility } from './accessibilityAnalyzer';
import { applyComponentCandidates, detectComponents } from './componentDetector';
import { decisionLog } from './confidenceEngine';
import { lintDesign } from './designLinter';
import { detectRepetitions } from './repetitionDetector';
import { toSmartNode } from './semanticAnalyzer';
import { detectDesignTokens, inferSpacingBase } from './tokenDetector';
import { detectVariants } from './variantDetector';

export interface SmartAnalysisOptions {
  debug: boolean;
  maxNodes: number;
  smallDesignDepth: number;
  mediumDesignDepth: number;
  largeDesignDepth: number;
}

export const SMART_ANALYSIS_DEFAULTS: Readonly<SmartAnalysisOptions> = {
  debug: false,
  maxNodes: 750,
  smallDesignDepth: 12,
  mediumDesignDepth: 8,
  largeDesignDepth: 6
};

function boundedCount(roots: readonly ParsedNode[], maximum: number): number {
  let count = 0;
  const stack = [...roots];
  while (stack.length && count <= maximum) {
    const node = stack.pop()!;
    count += 1;
    stack.push(...node.children);
  }
  return count;
}

function depthFor(count: number, options: SmartAnalysisOptions): number {
  if (count <= 100) return options.smallDesignDepth;
  if (count <= 350) return options.mediumDesignDepth;
  return options.largeDesignDepth;
}

export function analyzeSmartNodes(
  parsedRoots: readonly ParsedNode[],
  overrides: Partial<SmartAnalysisOptions> = {}
): SmartAnalysisResult {
  const options = { ...SMART_ANALYSIS_DEFAULTS, ...overrides };
  const estimated = boundedCount(parsedRoots, options.maxNodes + 1);
  const maxDepth = depthFor(estimated, options);
  let analyzed = 0;
  let truncated = false;
  let deepestTruncation = -1;
  const build = (node: ParsedNode, depth: number): { parsed: ParsedNode; smart: SmartNode } | null => {
    if (analyzed >= options.maxNodes || depth > maxDepth) {
      truncated = true;
      deepestTruncation = deepestTruncation < 0 ? depth : Math.min(deepestTruncation, depth);
      return null;
    }
    analyzed += 1;
    const children = node.children
      .map((child) => build(child, depth + 1))
      .filter((child): child is { parsed: ParsedNode; smart: SmartNode } => !!child);
    if (children.length !== node.children.length) truncated = true;
    const parsed: ParsedNode = { ...node, children: children.map((child) => child.parsed) };
    return {
      parsed,
      smart: toSmartNode(
        parsed,
        children.map((child) => child.smart)
      )
    };
  };
  const analyzedRoots = parsedRoots
    .map((root) => build(root, 0))
    .filter((root): root is { parsed: ParsedNode; smart: SmartNode } => !!root);
  const boundedParsedRoots = analyzedRoots.map((root) => root.parsed);
  const roots = analyzedRoots.map((root) => root.smart);
  const components = detectComponents(roots);
  applyComponentCandidates(roots, components);
  const repetitions = detectRepetitions(boundedParsedRoots, components);
  const variants = detectVariants(boundedParsedRoots, components);
  const tokens = detectDesignTokens(boundedParsedRoots);
  const lint = lintDesign(boundedParsedRoots, components);
  const accessibility = analyzeAccessibility(boundedParsedRoots, roots);
  const warnings: string[] = [];
  if (truncated)
    warnings.push(
      `Analysis truncated at depth ${Math.max(0, deepestTruncation)} because the selection is too complex (${analyzed}/${options.maxNodes} nodes analyzed).`
    );
  if (parsedRoots.some((root) => root.analysisLimited))
    warnings.push('A árvore original já chegou parcialmente analisada pelos limites seguros do plugin.');
  const spacingBase = inferSpacingBase(tokens);
  if (spacingBase) warnings.push(`Escala de spacing recorrente detectada com base provável de ${spacingBase}px.`);
  const debugLog = options.debug
    ? roots.flatMap(function walk(node): string[] {
        return [
          decisionLog(node.name, node.semanticType, node.confidence, node.evidence),
          ...node.children.flatMap(walk)
        ];
      })
    : [];
  return { roots, components, repetitions, variants, tokens, lint, accessibility, debugLog, warnings, truncated };
}
