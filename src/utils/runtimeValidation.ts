import type {
  AnalysisSummary,
  ClassGroup,
  Conversion,
  NodeCodegenMetadata,
  ParsedNode,
  PluginMessage,
  PreviewResult,
  TextSegmentInfo,
  UiMessage
} from '../types';
import type { LayoutAnalysis, SuggestedGroup } from '../types/layoutAnalysis';
import { isValidTailwindClass } from './classValidation';
import { MAX_PREVIEW_DATA_URL_CHARACTERS } from './previewLimits';
import { normalizeSettings } from './settings';

const MAX_ID = 512,
  MAX_MESSAGE = 4_096,
  MAX_NODES = 800;
const CATEGORIES = [
  'layout',
  'position',
  'display',
  'flex',
  'grid',
  'dimensions',
  'spacing',
  'typography',
  'background',
  'border',
  'effects',
  'misc'
] as const;
const PANEL_CATEGORIES = [
  'layout',
  'dimensions',
  'spacing',
  'typography',
  'colors',
  'borders',
  'effects',
  'positioning',
  'other'
] as const;
const FIDELITIES = [
  'exact',
  'equivalent',
  'arbitrary',
  'approximation',
  'ignored',
  'unsupported',
  'suggestion'
] as const;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const boundedText = (value: unknown, max = MAX_MESSAGE): value is string =>
  typeof value === 'string' && value.length <= max;
const optionalText = (value: unknown, max = MAX_MESSAGE): boolean => value === undefined || boundedText(value, max);
const requestId = (value: unknown): value is number => finite(value) && Number.isInteger(value) && value >= 0;
const oneOf = <T extends readonly string[]>(value: unknown, allowed: T): value is T[number] =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value);
const confidence = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const booleanOrUndefined = (value: unknown): boolean => value === undefined || typeof value === 'boolean';

function stringArray(value: unknown, max = 300, classNames = false): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => boundedText(item) && (classNames ? isValidTailwindClass(item) : true)) &&
    (!classNames || new Set(value).size === value.length)
  );
}

function isCodegenTextListItems(value: unknown, declaredType: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return false;
  let totalCharacters = 0;
  let rootLevel: number | undefined;
  let previousLevel: number | undefined;
  for (const valueItem of value) {
    const item = record(valueItem);
    if (
      !item ||
      !boundedText(item.text, 10_000) ||
      item.text.length === 0 ||
      !oneOf(item.type, ['ORDERED', 'UNORDERED'] as const) ||
      !finite(item.indentationLevel) ||
      !Number.isInteger(item.indentationLevel) ||
      item.indentationLevel < 0 ||
      item.indentationLevel > 100 ||
      !finite(item.itemSpacing) ||
      item.itemSpacing < 0 ||
      item.itemSpacing > 100_000
    )
      return false;
    totalCharacters += item.text.length;
    if (totalCharacters > 10_000) return false;
    rootLevel ??= item.indentationLevel;
    previousLevel ??= item.indentationLevel;
    if (item.indentationLevel < rootLevel || item.indentationLevel > previousLevel + 1) return false;
    previousLevel = item.indentationLevel;
  }
  return record(value[0])?.type === declaredType;
}

function isSource(value: unknown): boolean {
  if (value === undefined) return true;
  const source = record(value);
  if (!source || Object.keys(source).length > 30) return false;
  return Object.entries(source).every(([key, item]) => boundedText(key, 100) && (finite(item) || boundedText(item)));
}

function isUtility(value: unknown): boolean {
  if (value === undefined) return true;
  const utility = record(value);
  return (
    !!utility &&
    boundedText(utility.name, 200) &&
    (finite(utility.value) || boundedText(utility.value, 500)) &&
    boundedText(utility.className, MAX_MESSAGE) &&
    isValidTailwindClass(utility.className)
  );
}

export function isConversion(value: unknown): value is Conversion {
  const item = record(value);
  return (
    !!item &&
    oneOf(item.category, CATEGORIES) &&
    boundedText(item.property) &&
    boundedText(item.value) &&
    stringArray(item.classes, 100, true) &&
    isSource(item.source) &&
    optionalText(item.note) &&
    (item.fidelity === undefined || oneOf(item.fidelity, FIDELITIES)) &&
    isUtility(item.utility)
  );
}

export function isConversionGroup(value: unknown): value is ClassGroup {
  const group = record(value);
  return (
    !!group &&
    oneOf(group.category, PANEL_CATEGORIES) &&
    boundedText(group.label, 200) &&
    stringArray(group.classes, 300, true) &&
    Array.isArray(group.conversions) &&
    group.conversions.length <= 300 &&
    group.conversions.every(isConversion)
  );
}

export function isTextSegmentInfo(value: unknown): value is TextSegmentInfo {
  const item = record(value);
  if (!item || !boundedText(item.text, 500)) return false;
  return (
    (item.start === undefined || requestId(item.start)) &&
    (item.end === undefined || requestId(item.end)) &&
    (item.start === undefined || item.end === undefined || item.start <= item.end) &&
    (item.classes === undefined || stringArray(item.classes, 30, true)) &&
    optionalText(item.fontFamily, 300) &&
    (item.fontSize === undefined || finite(item.fontSize)) &&
    (item.fontWeight === undefined || finite(item.fontWeight)) &&
    optionalText(item.color, 100) &&
    optionalText(item.lineHeight, 100) &&
    optionalText(item.letterSpacing, 100) &&
    optionalText(item.decoration, 100) &&
    optionalText(item.textCase, 100)
  );
}

function isSuggestedGroup(value: unknown): value is SuggestedGroup {
  const group = record(value);
  return (
    !!group &&
    boundedText(group.name) &&
    stringArray(group.nodeIds, 100) &&
    stringArray(group.nodeNames, 100) &&
    stringArray(group.suggestedClasses, 100, true) &&
    confidence(group.confidence)
  );
}

export function isStructureAnalysis(value: unknown): value is LayoutAnalysis {
  const analysis = record(value);
  if (!analysis) return false;
  const evidence = analysis.classEvidence;
  const evidenceValid =
    evidence === undefined ||
    (Array.isArray(evidence) &&
      evidence.length <= 100 &&
      evidence.every((entry) => {
        const item = record(entry);
        return (
          !!item &&
          boundedText(item.className) &&
          isValidTailwindClass(item.className) &&
          oneOf(item.source, ['auto-layout', 'heuristic'] as const) &&
          confidence(item.confidence) &&
          oneOf(item.fidelity, ['exact', 'suggestion'] as const)
        );
      }));
  return (
    boundedText(analysis.nodeId, MAX_ID) &&
    boundedText(analysis.nodeName) &&
    oneOf(analysis.type, ['flex', 'grid', 'unknown'] as const) &&
    oneOf(analysis.direction, ['row', 'column', 'unknown'] as const) &&
    stringArray(analysis.classes, 100, true) &&
    confidence(analysis.confidence) &&
    oneOf(analysis.source, ['auto-layout', 'heuristic'] as const) &&
    boundedText(analysis.message) &&
    Array.isArray(analysis.groups) &&
    analysis.groups.length <= 100 &&
    analysis.groups.every(isSuggestedGroup) &&
    evidenceValid
  );
}

export function isPreviewDataUrl(value: unknown): value is string {
  return (
    boundedText(value, MAX_PREVIEW_DATA_URL_CHARACTERS) && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export function isPreviewResult(value: unknown): value is PreviewResult {
  const preview = record(value);
  return (
    !!preview &&
    requestId(preview.requestId) &&
    boundedText(preview.nodeId, MAX_ID) &&
    (preview.dataUrl === undefined || isPreviewDataUrl(preview.dataUrl))
  );
}

export function isNodeCodegenMetadata(value: unknown): value is NodeCodegenMetadata {
  const metadata = record(value);
  const hyperlink = metadata ? record(metadata.hyperlink) : null;
  const textList = metadata ? record(metadata.textList) : null;
  return (
    !!metadata &&
    (metadata.parentId === undefined || boundedText(metadata.parentId, MAX_ID)) &&
    (metadata.parentWidth === undefined || (finite(metadata.parentWidth) && metadata.parentWidth >= 0)) &&
    (metadata.parentHeight === undefined || (finite(metadata.parentHeight) && metadata.parentHeight >= 0)) &&
    finite(metadata.x) &&
    finite(metadata.y) &&
    finite(metadata.width) &&
    metadata.width >= 0 &&
    finite(metadata.height) &&
    metadata.height >= 0 &&
    booleanOrUndefined(metadata.visible) &&
    finite(metadata.rotation) &&
    oneOf(metadata.layoutMode, ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'] as const) &&
    (metadata.widthMode === undefined || oneOf(metadata.widthMode, ['auto', 'fixed', 'fill', 'stretch'] as const)) &&
    (metadata.heightMode === undefined || oneOf(metadata.heightMode, ['auto', 'fixed', 'fill', 'stretch'] as const)) &&
    booleanOrUndefined(metadata.clipsContent) &&
    (metadata.layoutPositioning === undefined || oneOf(metadata.layoutPositioning, ['AUTO', 'ABSOLUTE'] as const)) &&
    (metadata.text === undefined || boundedText(metadata.text, 10_000)) &&
    booleanOrUndefined(metadata.textTruncated) &&
    (metadata.hyperlink === undefined ||
      (!!hyperlink &&
        oneOf(hyperlink.type, ['URL', 'NODE'] as const) &&
        boundedText(hyperlink.value, 2_048) &&
        hyperlink.value.length > 0)) &&
    (metadata.textList === undefined ||
      (!!textList &&
        oneOf(textList.type, ['ORDERED', 'UNORDERED'] as const) &&
        isCodegenTextListItems(textList.items, textList.type) &&
        booleanOrUndefined(textList.hanging))) &&
    (metadata.textListIssue === undefined || oneOf(metadata.textListIssue, ['mixed', 'partial'] as const)) &&
    booleanOrUndefined(metadata.ambiguousImagePaint) &&
    booleanOrUndefined(metadata.complexTransform) &&
    booleanOrUndefined(metadata.reverseZIndex) &&
    (metadata.imageScaleMode === undefined ||
      oneOf(metadata.imageScaleMode, ['FILL', 'FIT', 'CROP', 'TILE'] as const)) &&
    (metadata.imageUsage === undefined ||
      oneOf(metadata.imageUsage, ['background', 'image-element', 'unknown'] as const))
  );
}

function parsedNode(value: unknown, state: { count: number }): value is ParsedNode {
  if (++state.count > MAX_NODES) return false;
  const node = record(value);
  if (!node) return false;
  if (
    !boundedText(node.id, MAX_ID) ||
    !boundedText(node.name) ||
    !boundedText(node.type, 100) ||
    !boundedText(node.dimensions, 100) ||
    !stringArray(node.classes, 300, true)
  )
    return false;
  if (!Array.isArray(node.conversions) || node.conversions.length > 300 || !node.conversions.every(isConversion))
    return false;
  if (!Array.isArray(node.groups) || node.groups.length > 30 || !node.groups.every(isConversionGroup)) return false;
  if (
    !stringArray(node.unsupported, 200) ||
    !Array.isArray(node.children) ||
    node.children.length > 500 ||
    !node.children.every((child) => parsedNode(child, state))
  )
    return false;
  if (typeof node.isVector !== 'boolean' || typeof node.analysisLimited !== 'boolean') return false;
  if (node.structure !== null && !isStructureAnalysis(node.structure)) return false;
  if (node.suggestions !== undefined && !stringArray(node.suggestions, 100)) return false;
  if (
    node.textSegments !== undefined &&
    (!Array.isArray(node.textSegments) || node.textSegments.length > 100 || !node.textSegments.every(isTextSegmentInfo))
  )
    return false;
  if (node.previewDataUrl !== undefined && !isPreviewDataUrl(node.previewDataUrl)) return false;
  if (node.codegen !== undefined && !isNodeCodegenMetadata(node.codegen)) return false;
  return booleanOrUndefined(node.detailsLoaded) && optionalText(node.parseError);
}

export function isParsedNode(value: unknown): value is ParsedNode {
  return parsedNode(value, { count: 0 });
}

function analysisSummary(value: unknown): value is AnalysisSummary {
  const item = record(value);
  return (
    !!item &&
    typeof item.partial === 'boolean' &&
    requestId(item.analyzed) &&
    requestId(item.skipped) &&
    (item.truncatedDepth === undefined || requestId(item.truncatedDepth)) &&
    (item.reason === undefined || oneOf(item.reason, ['performance-limit', 'root-limit', 'payload-limit'] as const))
  );
}

export function parseUiMessage(value: unknown): UiMessage | null {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return null;
  if (message.type === 'refresh' || message.type === 'reset-settings') return { type: message.type };
  if (message.type === 'resize')
    return finite(message.height) ? { type: 'resize', height: Math.max(500, Math.min(900, message.height)) } : null;
  if (message.type === 'save-settings') return { type: 'save-settings', settings: normalizeSettings(message.settings) };
  if (
    (message.type === 'request-preview' || message.type === 'request-node-details') &&
    requestId(message.requestId) &&
    boundedText(message.nodeId, MAX_ID)
  )
    return { type: message.type, requestId: message.requestId, nodeId: message.nodeId };
  if (
    message.type === 'request-selection-details' &&
    requestId(message.requestId) &&
    Array.isArray(message.nodeIds) &&
    message.nodeIds.length > 0 &&
    message.nodeIds.length <= 50 &&
    message.nodeIds.every((nodeId) => boundedText(nodeId, MAX_ID)) &&
    new Set(message.nodeIds).size === message.nodeIds.length
  )
    return { type: 'request-selection-details', requestId: message.requestId, nodeIds: message.nodeIds };
  return null;
}

export function parsePluginMessage(value: unknown): PluginMessage | null {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return null;
  if (message.type === 'notice' && boundedText(message.message)) return { type: 'notice', message: message.message };
  if (message.type === 'selection-pending' && requestId(message.requestId))
    return { type: 'selection-pending', requestId: message.requestId };
  if (message.type === 'settings') return { type: 'settings', settings: normalizeSettings(message.settings) };
  if (message.type === 'preview' && isPreviewResult(message))
    return {
      type: 'preview',
      requestId: message.requestId,
      nodeId: message.nodeId,
      ...(message.dataUrl ? { dataUrl: message.dataUrl } : {})
    };
  if (
    message.type === 'selection' &&
    requestId(message.requestId) &&
    Array.isArray(message.nodes) &&
    message.nodes.length <= 50 &&
    analysisSummary(message.analysis)
  ) {
    const state = { count: 0 };
    if (!message.nodes.every((node) => parsedNode(node, state))) return null;
    return {
      type: 'selection',
      requestId: message.requestId,
      nodes: message.nodes,
      analysis: {
        partial: message.analysis.partial,
        analyzed: message.analysis.analyzed,
        skipped: message.analysis.skipped,
        ...(message.analysis.truncatedDepth !== undefined ? { truncatedDepth: message.analysis.truncatedDepth } : {}),
        ...(message.analysis.reason ? { reason: message.analysis.reason } : {})
      },
      ...(boundedText(message.error) ? { error: message.error } : {})
    };
  }
  if (message.type === 'node-details' && requestId(message.requestId) && boundedText(message.nodeId, MAX_ID)) {
    if (message.node !== undefined && !isParsedNode(message.node)) return null;
    if (message.analysis !== undefined && !analysisSummary(message.analysis)) return null;
    return {
      type: 'node-details',
      requestId: message.requestId,
      nodeId: message.nodeId,
      ...(message.node ? { node: message.node } : {}),
      ...(message.analysis
        ? {
            analysis: {
              partial: message.analysis.partial,
              analyzed: message.analysis.analyzed,
              skipped: message.analysis.skipped,
              ...(message.analysis.truncatedDepth !== undefined
                ? { truncatedDepth: message.analysis.truncatedDepth }
                : {}),
              ...(message.analysis.reason ? { reason: message.analysis.reason } : {})
            }
          }
        : {}),
      ...(boundedText(message.error) ? { error: message.error } : {})
    };
  }
  return null;
}
