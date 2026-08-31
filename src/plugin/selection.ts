import type { AnalysisSummary, ParsedNode, Settings } from '../types';
import { safeParseNode } from './nodeParser';
import { ANALYSIS_LIMITS, AnalysisBudget } from './analysisBudget';
import { enforcePayloadBudget } from './payloadBudget';
import { RESPONSIVE_LIMITS } from '../responsive/config';
import { PNG_DATA_URL_PREFIX, previewBytesFitDataUrl } from '../utils/previewLimits';

export function previewConstraint(width: number, height: number): ExportSettingsConstraints {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return { type: 'WIDTH', value: 1 };
  const longest = Math.max(width, height);
  const target = Math.max(1, Math.round(Math.min(720, longest * 2)));
  return { type: width >= height ? 'WIDTH' : 'HEIGHT', value: target };
}

export async function exportNodePreview(node: SceneNode): Promise<string | undefined> {
  try {
    if (!('exportAsync' in node)) return undefined;
    const { width, height } = node;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    const constraint = previewConstraint(width, height);
    const bytes = await node.exportAsync({ format: 'PNG', contentsOnly: true, constraint });
    if (!previewBytesFitDataUrl(bytes.length)) return undefined;
    return `${PNG_DATA_URL_PREFIX}${figma.base64Encode(bytes)}`;
  } catch {
    return undefined;
  }
}

export interface SelectionParseResult {
  nodes: ParsedNode[];
  analysis: AnalysisSummary;
}
export interface NodeDetailsResult {
  node?: ParsedNode;
  analysis: AnalysisSummary;
  error?: string;
}

export interface SelectionDetailsResult {
  nodes: ParsedNode[];
  analysis: AnalysisSummary;
  omittedNodeIds: string[];
}

export function parseSelectionSummary(settings: Settings): SelectionParseResult {
  const budget = new AnalysisBudget();
  const selected = [...figma.currentPage.selection];
  const nodes: ParsedNode[] = [];
  const rootLimit = Math.min(selected.length, ANALYSIS_LIMITS.maxRoots);
  for (const node of selected.slice(0, rootLimit)) {
    if (!budget.tryRoot()) break;
    const parsed = safeParseNode(node, settings, budget, { includeChildren: false, includeStructure: false });
    if (parsed.result) nodes.push(parsed.result);
  }
  if (selected.length > rootLimit) budget.registerSkipped(selected.length - rootLimit, 'root-limit');
  const payload = enforcePayloadBudget(nodes, ANALYSIS_LIMITS);
  if (payload.reduced) budget.markPartial('payload-limit');
  const analysis = budget.snapshot();
  for (const node of nodes) node.analysisLimited = analysis.partial;
  return { nodes, analysis };
}

export function parseNodeDetails(node: SceneNode, settings: Settings): NodeDetailsResult {
  const budget = new AnalysisBudget();
  const parsed = safeParseNode(node, settings, budget, { includeChildren: true, includeStructure: true });
  if (parsed.result && enforcePayloadBudget([parsed.result], ANALYSIS_LIMITS).reduced)
    budget.markPartial('payload-limit');
  const analysis = budget.snapshot();
  if (parsed.result) parsed.result.analysisLimited = analysis.partial;
  return {
    ...(parsed.result ? { node: parsed.result } : {}),
    analysis,
    ...(parsed.error ? { error: parsed.error } : {})
  };
}

/** Parses multiple selected roots under one shared node and payload budget. */
export function parseSelectionDetails(nodes: readonly SceneNode[], settings: Settings): SelectionDetailsResult {
  const budget = new AnalysisBudget();
  const parsedNodes: ParsedNode[] = [];
  const omittedNodeIds: string[] = [];
  for (const [index, node] of nodes.entries()) {
    if (!budget.tryRoot()) {
      const remaining = nodes.slice(index).map((item) => item.id);
      omittedNodeIds.push(...remaining);
      budget.registerSkipped(remaining.length, 'root-limit');
      break;
    }
    const parsed = safeParseNode(node, settings, budget, { includeChildren: true, includeStructure: true });
    if (parsed.result) parsedNodes.push(parsed.result);
    else {
      omittedNodeIds.push(node.id);
      const remaining = nodes.slice(index + 1).map((item) => item.id);
      omittedNodeIds.push(...remaining);
      budget.registerSkipped(1 + remaining.length, 'performance-limit');
      break;
    }
  }
  if (enforcePayloadBudget(parsedNodes, ANALYSIS_LIMITS).reduced) budget.markPartial('payload-limit');
  const analysis = budget.snapshot();
  if (analysis.partial) for (const node of parsedNodes) node.analysisLimited = true;
  return { nodes: parsedNodes, analysis, omittedNodeIds };
}

/** Uses an isolated budget per viewport so one large Frame cannot starve the other responsive variants. */
export function parseResponsiveSelectionDetails(
  nodes: readonly SceneNode[],
  settings: Settings
): SelectionDetailsResult {
  const parsedNodes: ParsedNode[] = [];
  const omittedNodeIds: string[] = [];
  const analyses: AnalysisSummary[] = [];
  const limits = {
    ...ANALYSIS_LIMITS,
    maxRoots: 1,
    maxNodes: RESPONSIVE_LIMITS.maxNodesPerFrame,
    maxChildrenPerNode: RESPONSIVE_LIMITS.maxNodesPerFrame,
    maxDepth: RESPONSIVE_LIMITS.maxComparisonDepth,
    maxStructureNodes: RESPONSIVE_LIMITS.maxNodesPerFrame
  };
  for (const node of nodes.slice(0, RESPONSIVE_LIMITS.maxFrames)) {
    const budget = new AnalysisBudget(limits);
    budget.tryRoot();
    const parsed = safeParseNode(node, settings, budget, { includeChildren: true, includeStructure: true });
    const analysis = budget.snapshot();
    analyses.push(analysis);
    if (parsed.result) {
      parsed.result.analysisLimited = parsed.result.analysisLimited || analysis.partial;
      parsedNodes.push(parsed.result);
    } else omittedNodeIds.push(node.id);
  }
  if (nodes.length > RESPONSIVE_LIMITS.maxFrames)
    omittedNodeIds.push(...nodes.slice(RESPONSIVE_LIMITS.maxFrames).map((node) => node.id));
  let payloadLimited = false;
  for (const node of parsedNodes) {
    if (!enforcePayloadBudget([node], ANALYSIS_LIMITS).reduced) continue;
    payloadLimited = true;
    node.analysisLimited = true;
  }
  const partial = payloadLimited || omittedNodeIds.length > 0 || analyses.some((analysis) => analysis.partial);
  const reason = payloadLimited
    ? 'payload-limit'
    : omittedNodeIds.length > 0
      ? 'root-limit'
      : analyses.find((analysis) => analysis.reason)?.reason;
  return {
    nodes: parsedNodes,
    omittedNodeIds,
    analysis: {
      partial,
      analyzed: analyses.reduce((total, analysis) => total + analysis.analyzed, 0),
      skipped: omittedNodeIds.length + analyses.reduce((total, analysis) => total + analysis.skipped, 0),
      ...(reason ? { reason } : {})
    }
  };
}

export async function parseSelection(settings: Settings): Promise<ParsedNode[]> {
  return parseSelectionSummary(settings).nodes;
}
