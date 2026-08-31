import {
  borders,
  hasCustomDashPattern,
  hasVisibleStroke,
  supportsBoxStroke,
  usesInnerOutline
} from '../converters/borders';
import { paintColor } from '../converters/colors';
import { dimension, getDimensionBehavior, nodeDimensions } from '../converters/dimensions';
import { effects } from '../converters/effects';
import { autoLayout, clipping, gridItem } from '../converters/layout';
import { opacity } from '../converters/opacity';
import { positioning, positioningContext } from '../converters/position';
import { padding } from '../converters/spacing';
import { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight, typography } from '../converters/typography';
import {
  DEFAULT_SETTINGS,
  type CodegenLayoutMode,
  type CodegenImageUsage,
  type CodegenTextList,
  type Conversion,
  type NodeCodegenMetadata,
  type ParsedNode,
  type Settings,
  type TextSegmentInfo
} from '../types';
import { sortedClasses } from '../utils/classSorter';
import { groupConversions } from '../utils/categoryGroups';
import type { Rgba } from '../utils/colors';
import { normalizeStructure } from '../analyzers/normalization';
import { analyzeStructure } from '../analyzers/structureAnalyzer';
import { structureConfigFromSettings } from '../analyzers/config';
import { conversionFidelity, responsiveSuggestions } from '../utils/conversionInsights';
import { toHex } from '../utils/colors';
import { AnalysisBudget } from './analysisBudget';
import { logger } from '../utils/logger';
import { snapshotNode } from './nodeSnapshot';

const VECTOR_TYPES = new Set<SceneNode['type']>(['VECTOR', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON', 'BOOLEAN_OPERATION']);
const MAX_CODEGEN_TEXT_CHARACTERS = 10_000;
const MAX_CODEGEN_LIST_ITEMS = 100;

function imageUsageForNode(node: SceneNode): CodegenImageUsage {
  if ('children' in node) return 'background';
  if (node.type === 'RECTANGLE' || node.type === 'ELLIPSE') return 'image-element';
  return 'unknown';
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface CodegenPositionNodeLike {
  x: number;
  y: number;
  absoluteBoundingBox?: { x: number; y: number } | null;
  absoluteTransform?: unknown;
  parent?: unknown;
}

type CodegenTransform = [[number, number, number], [number, number, number]];

function transform(value: unknown): CodegenTransform | null {
  if (!Array.isArray(value) || value.length !== 2 || !Array.isArray(value[0]) || !Array.isArray(value[1])) return null;
  const values = [...value[0], ...value[1]];
  return values.length === 6 && values.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? (value as CodegenTransform)
    : null;
}

function transformFrom(value: unknown, property: 'absoluteTransform' | 'relativeTransform'): CodegenTransform | null {
  if (typeof value !== 'object' || value === null || !(property in value)) return null;
  return transform((value as Record<string, unknown>)[property]);
}

function absolutePosition(value: unknown): { x: number; y: number } | null {
  if (typeof value !== 'object' || value === null || !('absoluteBoundingBox' in value)) return null;
  const box = value.absoluteBoundingBox;
  if (typeof box !== 'object' || box === null || !('x' in box) || !('y' in box)) return null;
  return typeof box.x === 'number' && Number.isFinite(box.x) && typeof box.y === 'number' && Number.isFinite(box.y)
    ? { x: box.x, y: box.y }
    : null;
}

export function relativeCodegenPosition(node: CodegenPositionNodeLike): { x: number; y: number } {
  const childTransform = transformFrom(node, 'absoluteTransform'),
    parentTransform = transformFrom(node.parent, 'absoluteTransform');
  if (childTransform && parentTransform) {
    const a = parentTransform[0][0],
      c = parentTransform[0][1],
      e = parentTransform[0][2],
      b = parentTransform[1][0],
      d = parentTransform[1][1],
      f = parentTransform[1][2],
      determinant = a * d - b * c;
    if (Math.abs(determinant) > 0.000001) {
      const deltaX = childTransform[0][2] - e,
        deltaY = childTransform[1][2] - f;
      return {
        x: (d * deltaX - c * deltaY) / determinant,
        y: (-b * deltaX + a * deltaY) / determinant
      };
    }
  }
  const child = absolutePosition(node),
    parent = absolutePosition(node.parent);
  return child && parent
    ? { x: child.x - parent.x, y: child.y - parent.y }
    : { x: finiteOrZero(node.x), y: finiteOrZero(node.y) };
}

function hasComplexTransform(node: SceneNode): boolean {
  const matrix = transformFrom(node, 'relativeTransform');
  if (!matrix) return false;
  const a = matrix[0][0],
    c = matrix[0][1],
    b = matrix[1][0],
    d = matrix[1][1],
    firstLength = Math.hypot(a, b),
    secondLength = Math.hypot(c, d),
    perpendicular = a * c + b * d,
    determinant = a * d - b * c;
  return (
    Math.abs(firstLength - 1) > 0.001 ||
    Math.abs(secondLength - 1) > 0.001 ||
    Math.abs(perpendicular) > 0.001 ||
    determinant < 0
  );
}

type CodegenListKind = CodegenTextList['type'];
type CodegenListItem = CodegenTextList['items'][number];

interface ListLine {
  text: string;
  kinds: Set<TextListOptions['type']>;
  indentationLevels: Set<number>;
  spacings: Set<number>;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function listTextItems(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildUniformTextList(
  node: TextNode,
  type: CodegenListKind,
  text: string,
  indentationLevel?: number,
  itemSpacing?: number,
  sourcePartial = false
): { list?: CodegenTextList; issue?: 'partial' } {
  const texts = listTextItems(text);
  if (sourcePartial || texts.length > MAX_CODEGEN_LIST_ITEMS) return { issue: 'partial' };
  if (!texts.length) return {};
  const level = indentationLevel !== undefined && Number.isInteger(indentationLevel) ? indentationLevel : 1;
  const spacing = itemSpacing ?? 0;
  return {
    list: {
      type,
      items: texts.map((item) => ({ text: item, type, indentationLevel: level, itemSpacing: spacing })),
      ...(typeof node.hangingList === 'boolean' ? { hanging: node.hangingList } : {})
    }
  };
}

function listFromStyledSegments(node: TextNode, end: number): { list?: CodegenTextList; issue?: 'mixed' | 'partial' } {
  if (typeof node.getStyledTextSegments !== 'function') return { issue: 'partial' };
  const lines: ListLine[] = [];
  let line: ListLine = { text: '', kinds: new Set(), indentationLevels: new Set(), spacings: new Set() };
  const finishLine = (): void => {
    lines.push(line);
    line = { text: '', kinds: new Set(), indentationLevels: new Set(), spacings: new Set() };
  };

  const chunkSize = 4_096;
  for (let cursor = 0; cursor < end; cursor += chunkSize) {
    const chunkEnd = Math.min(end, cursor + chunkSize);
    const segments = node.getStyledTextSegments(['listOptions', 'indentation', 'listSpacing'], cursor, chunkEnd);
    for (const segment of segments) {
      const indentation = finiteNonNegative(segment.indentation);
      const spacing = finiteNonNegative(segment.listSpacing);
      const parts = segment.characters.replace(/\r\n?/g, '\n').split('\n');
      parts.forEach((part, index) => {
        line.text += part;
        if (part.length > 0) {
          line.kinds.add(segment.listOptions.type);
          if (indentation !== undefined) line.indentationLevels.add(indentation);
          if (spacing !== undefined) line.spacings.add(spacing);
        }
        if (index < parts.length - 1) finishLine();
      });
      if (lines.length > MAX_CODEGEN_LIST_ITEMS) return { issue: 'partial' };
    }
  }
  if (line.text.length || !lines.length) finishLine();

  const populated = lines.filter((item) => item.text.trim());
  const items: CodegenListItem[] = [];
  for (const item of populated) {
    if (item.kinds.size !== 1 || item.kinds.has('NONE')) return { issue: 'mixed' };
    const type = [...item.kinds][0];
    if (type !== 'ORDERED' && type !== 'UNORDERED') return { issue: 'mixed' };
    if (item.indentationLevels.size !== 1 || item.spacings.size !== 1) return { issue: 'mixed' };
    const indentationLevel = [...item.indentationLevels][0]!;
    const itemSpacing = [...item.spacings][0]!;
    if (!Number.isInteger(indentationLevel)) return { issue: 'mixed' };
    items.push({ text: item.text.trim(), type, indentationLevel, itemSpacing });
  }
  if (!items.length) return {};
  if (node.characters.length > end || items.length > MAX_CODEGEN_LIST_ITEMS) return { issue: 'partial' };
  const rootLevel = items[0]!.indentationLevel;
  let previousLevel = rootLevel;
  for (const item of items) {
    if (item.indentationLevel < rootLevel || item.indentationLevel > previousLevel + 1) return { issue: 'mixed' };
    previousLevel = item.indentationLevel;
  }
  return {
    list: {
      type: items[0]!.type,
      items,
      ...(typeof node.hangingList === 'boolean' ? { hanging: node.hangingList } : {})
    }
  };
}

export function textListMetadata(node: TextNode): { list?: CodegenTextList; issue?: 'mixed' | 'partial' } {
  const end = Math.min(node.characters.length, MAX_CODEGEN_TEXT_CHARACTERS);
  if (!end) return {};
  try {
    // Most TextNodes are not lists. The range API avoids allocating styled
    // segments for ordinary text selected in large groups.
    if (typeof node.getRangeListOptions === 'function') {
      const options = node.getRangeListOptions(0, end);
      if (typeof options !== 'symbol') {
        if (options.type === 'NONE') return {};
        const indentation =
          typeof node.getRangeIndentation === 'function' ? node.getRangeIndentation(0, end) : undefined;
        const spacing = typeof node.getRangeListSpacing === 'function' ? node.getRangeListSpacing(0, end) : undefined;
        if (typeof indentation !== 'symbol' && typeof spacing !== 'symbol') {
          return buildUniformTextList(
            node,
            options.type,
            node.characters.slice(0, end),
            finiteNonNegative(indentation),
            finiteNonNegative(spacing),
            node.characters.length > end
          );
        }
      }
    }
    return listFromStyledSegments(node, end);
  } catch {
    return { issue: 'partial' };
  }
}

function codegenMetadata(node: SceneNode): NodeCodegenMetadata {
  const layoutMode: CodegenLayoutMode =
    'layoutMode' in node && ['HORIZONTAL', 'VERTICAL', 'GRID'].includes(node.layoutMode) ? node.layoutMode : 'NONE';
  const visibleFills =
    'fills' in node && Array.isArray(node.fills)
      ? node.fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001)
      : [];
  const images = visibleFills.filter((paint): paint is ImagePaint => paint.type === 'IMAGE');
  const image = visibleFills.length === 1 && images.length === 1 ? images[0] : undefined;
  const imageUsage = imageUsageForNode(node);
  const textNode = node.type === 'TEXT' ? node : undefined;
  const text = textNode?.characters.slice(0, MAX_CODEGEN_TEXT_CHARACTERS);
  const hyperlink =
    textNode?.hyperlink && typeof textNode.hyperlink !== 'symbol' && textNode.hyperlink.value.length <= 2_048
      ? { type: textNode.hyperlink.type, value: textNode.hyperlink.value }
      : undefined;
  const listMetadata = textNode ? textListMetadata(textNode) : {};
  const layoutPositioning =
    'layoutPositioning' in node && (node.layoutPositioning === 'AUTO' || node.layoutPositioning === 'ABSOLUTE')
      ? node.layoutPositioning
      : undefined;
  const position = relativeCodegenPosition(node);
  const dimensionBehavior = getDimensionBehavior(node);
  const parentSize =
    node.parent && 'width' in node.parent && 'height' in node.parent
      ? { width: finiteOrZero(node.parent.width), height: finiteOrZero(node.parent.height) }
      : undefined;
  return {
    ...(node.parent?.id ? { parentId: node.parent.id } : {}),
    ...(parentSize ? { parentWidth: parentSize.width, parentHeight: parentSize.height } : {}),
    x: position.x,
    y: position.y,
    width: finiteOrZero(node.width),
    height: finiteOrZero(node.height),
    visible: node.visible,
    rotation: 'rotation' in node ? finiteOrZero(node.rotation) : 0,
    layoutMode,
    widthMode: dimensionBehavior.width.mode,
    heightMode: dimensionBehavior.height.mode,
    ...('clipsContent' in node ? { clipsContent: node.clipsContent } : {}),
    ...(layoutPositioning ? { layoutPositioning } : {}),
    ...(text !== undefined
      ? { text, textTruncated: (textNode?.characters.length ?? 0) > MAX_CODEGEN_TEXT_CHARACTERS }
      : {}),
    ...(hyperlink ? { hyperlink } : {}),
    ...(listMetadata.list ? { textList: listMetadata.list } : {}),
    ...(listMetadata.issue ? { textListIssue: listMetadata.issue } : {}),
    ...(image ? { imageScaleMode: image.scaleMode, imageUsage } : {}),
    ...(images.length > 0 && !image ? { ambiguousImagePaint: true } : {}),
    ...(hasComplexTransform(node) ? { complexTransform: true } : {}),
    ...('itemReverseZIndex' in node && node.itemReverseZIndex ? { reverseZIndex: true } : {})
  };
}

function solidPaint(paints: readonly Paint[] | PluginAPI['mixed']): SolidPaint | undefined {
  return Array.isArray(paints)
    ? paints.find((p): p is SolidPaint => p.type === 'SOLID' && p.visible !== false && (p.opacity ?? 1) > 0.001)
    : undefined;
}

function paintRgba(paint: SolidPaint): Rgba {
  return { ...paint.color, a: paint.opacity ?? 1 };
}

function fillConversions(node: SceneNode, settings: Settings): Conversion[] {
  if (!('fills' in node) || !Array.isArray(node.fills)) return [];
  const visible = node.fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001);
  const fill = visible.length === 1 && visible[0]?.type === 'SOLID' ? visible[0] : undefined;
  if (!fill) return [];
  return [paintColor(node.type === 'TEXT' ? 'text' : 'background', paintRgba(fill), settings)];
}

function strokeConversions(node: SceneNode, settings: Settings): Conversion[] {
  if (!hasVisibleStroke(node) || !('strokes' in node) || !Array.isArray(node.strokes)) return [];
  const visible = node.strokes.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001);
  const stroke = visible.length === 1 ? solidPaint(visible) : undefined;
  if (!stroke) return [];
  const converted = paintColor(usesInnerOutline(node) ? 'outline' : 'border', paintRgba(stroke), settings);
  if (hasCustomDashPattern(node))
    return [
      {
        ...converted,
        classes: [],
        fidelity: 'unsupported',
        note: 'Cor preservada como referência; o padrão de traço personalizado não foi convertido.'
      }
    ];
  if (supportsBoxStroke(node)) return [converted];
  return [
    {
      ...converted,
      property: node.type === 'TEXT' ? 'text stroke color' : 'vector stroke color',
      classes: [],
      fidelity: 'unsupported',
      note: 'Informação preservada; o stroke pertence ao conteúdo, não à caixa CSS.'
    }
  ];
}

function nonBoxStrokeWidth(node: SceneNode): Conversion[] {
  if (
    supportsBoxStroke(node) ||
    !hasVisibleStroke(node) ||
    !('strokeWeight' in node) ||
    typeof node.strokeWeight !== 'number'
  )
    return [];
  return [
    {
      category: 'border',
      property: node.type === 'TEXT' ? 'text stroke width' : 'vector stroke width',
      value: `${node.strokeWeight}px`,
      classes: [],
      source: { strokeWeight: node.strokeWeight },
      fidelity: 'unsupported',
      note: 'Sem equivalente Tailwind direto para o desenho interno.'
    }
  ];
}

export function imageConversion(node: SceneNode): Conversion[] {
  if (!('fills' in node) || !Array.isArray(node.fills)) return [];
  const visiblePaints = node.fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001);
  const images = visiblePaints.filter((paint): paint is ImagePaint => paint.type === 'IMAGE');
  if (!images.length) return [];
  if (images.length !== 1 || visiblePaints.length !== 1)
    return [
      {
        category: 'misc',
        property: 'image fill composition',
        value: `${images.length} image fill(s), ${visiblePaints.length} visible fill(s)`,
        classes: [],
        source: { imageUsage: 'unknown' },
        fidelity: 'unsupported',
        note: 'Fills combinados não foram simplificados; exporte a composição achatada ou recrie as camadas manualmente.'
      }
    ];
  const image = images[0]!;
  const imageUsage = imageUsageForNode(node);
  const backgroundUsage = imageUsage === 'background';
  let scaleConversion: Conversion;
  if (backgroundUsage && image.scaleMode === 'FILL')
    scaleConversion = {
      category: 'misc',
      property: 'image fill mode',
      value: 'FILL',
      classes: ['bg-cover', 'bg-center'],
      source: { imageUsage },
      fidelity: 'equivalent',
      note: 'O ImagePaint foi interpretado como background do container.'
    };
  else if (backgroundUsage && image.scaleMode === 'FIT')
    scaleConversion = {
      category: 'misc',
      property: 'image fill mode',
      value: 'FIT',
      classes: ['bg-contain', 'bg-center', 'bg-no-repeat'],
      source: { imageUsage },
      fidelity: 'equivalent',
      note: 'O ImagePaint foi interpretado como background do container.'
    };
  else if (image.scaleMode === 'FILL' || image.scaleMode === 'FIT')
    scaleConversion = {
      category: 'misc',
      property: 'image fill mode',
      value: image.scaleMode,
      classes: [],
      source: { imageUsage },
      fidelity: 'suggestion',
      note: `Contexto HTML desconhecido: use ${image.scaleMode === 'FILL' ? 'bg-cover em um background ou object-cover em <img>' : 'bg-contain em um background ou object-contain em <img>'}.`
    };
  else
    scaleConversion = {
      category: 'misc',
      property: 'image fill mode',
      value: image.scaleMode,
      classes: [],
      source: { imageUsage },
      fidelity: 'unsupported',
      note: 'CROP e TILE dependem do recorte/posicionamento da imagem; nenhuma classe foi inferida.'
    };
  const result: Conversion[] = [scaleConversion];
  const imageOpacity = image.opacity ?? 1;
  if (imageOpacity < 1) {
    const noChildren = !('children' in node) || node.children.length === 0;
    const noOtherRendering =
      visiblePaints.length === 1 &&
      !hasVisibleStroke(node) &&
      (!('effects' in node) ||
        !Array.isArray(node.effects) ||
        node.effects.every((effect) => effect.visible === false));
    const nodeIsOpaque = !('opacity' in node) || node.opacity >= 1;
    const safe = noChildren && noOtherRendering && nodeIsOpaque;
    const converted = safe ? opacity(imageOpacity) : null;
    result.push({
      category: 'misc',
      property: 'image opacity',
      value: `${Number((imageOpacity * 100).toFixed(2))}%`,
      classes: converted?.classes ?? [],
      source: { imageOpacity },
      fidelity: safe ? (converted?.classes[0]?.includes('[') ? 'arbitrary' : 'equivalent') : 'unsupported',
      note: safe
        ? 'A opacidade do paint equivale à opacidade deste elemento de imagem isolado.'
        : 'Opacidade preservada como informação; aplicá-la ao elemento também afetaria strokes, efeitos ou filhos.'
    });
  }
  return result;
}

function unsupportedPaints(node: SceneNode): string[] {
  if (!('fills' in node) || !Array.isArray(node.fills)) return [];
  const visible = node.fills.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001);
  const messages: string[] = [];
  const gradients = visible.filter((paint) => paint.type.startsWith('GRADIENT_'));
  if (gradients.length)
    messages.push(
      `Gradiente (${gradients.map((paint) => paint.type.replace('GRADIENT_', '').toLowerCase()).join(', ')}): sem conversão Tailwind segura.`
    );
  const unsupported = visible.filter(
    (paint) => paint.type !== 'SOLID' && paint.type !== 'IMAGE' && !paint.type.startsWith('GRADIENT_')
  );
  for (const paint of unsupported) messages.push(`Fill ${paint.type}: sem equivalente direto.`);
  if (visible.filter((paint) => paint.type === 'SOLID').length > 1)
    messages.push('Múltiplos fills sólidos: nenhuma cor única foi convertida; preserve a composição de camadas.');
  if (visible.filter((paint) => paint.type === 'IMAGE').length > 1)
    messages.push('Múltiplos fills de imagem: nenhuma imagem única foi convertida; preserve a composição de camadas.');
  if (visible.length > 1 && new Set(visible.map((paint) => paint.type)).size > 1)
    messages.push(
      'Fills combinados: revise a composição de camadas; classes simples podem não reproduzir o resultado completo.'
    );
  return messages;
}

function unsupportedStrokes(node: SceneNode): string[] {
  if (!('strokes' in node) || !Array.isArray(node.strokes)) return [];
  const visible = node.strokes.filter((paint) => paint.visible !== false && (paint.opacity ?? 1) > 0.001),
    messages: string[] = [];
  const unsupported = visible.filter((paint) => paint.type !== 'SOLID');
  for (const paint of unsupported) messages.push(`Stroke ${paint.type}: cor/gradiente sem conversão Tailwind direta.`);
  if (visible.filter((paint) => paint.type === 'SOLID').length > 1)
    messages.push('Múltiplos strokes sólidos: nenhuma cor única de stroke foi convertida.');
  return messages;
}

export function imagePaintWarnings(node: SceneNode): string[] {
  if (!('fills' in node) || !Array.isArray(node.fills)) return [];
  const images = node.fills.filter(
    (paint): paint is ImagePaint => paint.type === 'IMAGE' && paint.visible !== false && (paint.opacity ?? 1) > 0.001
  );
  const warnings: string[] = [];
  for (const image of images) {
    if (!image.imageHash) warnings.push('Imagem sem imageHash disponível: o asset pode não estar exportável.');
    if (Math.abs(image.rotation ?? 0) > 0.01)
      warnings.push(
        `ImagePaint rotacionado (${Number((image.rotation ?? 0).toFixed(2))}°): revise o recorte do asset.`
      );
    if (image.blendMode !== 'NORMAL')
      warnings.push(`ImagePaint com blend mode ${image.blendMode}: sem equivalente Tailwind direto e confiável.`);
    const filters = image.filters;
    if (
      filters &&
      [
        filters.exposure,
        filters.contrast,
        filters.saturation,
        filters.temperature,
        filters.tint,
        filters.highlights,
        filters.shadows
      ].some((value) => Math.abs(value ?? 0) > 0.0001)
    )
      warnings.push(
        'ImagePaint com filtros de imagem: os ajustes não foram convertidos para evitar aproximação visual.'
      );
  }
  return warnings;
}

function mixedTypographyWarnings(node: TextNode): string[] {
  const warnings: string[] = [];
  if (typeof node.fills === 'symbol')
    warnings.push('Texto com múltiplas cores: use spans separados para preservar a cor de cada trecho.');
  if (typeof node.fontName === 'symbol')
    warnings.push('Texto com múltiplas fontes ou estilos: use spans separados para preservar cada trecho.');
  if (typeof node.fontSize === 'symbol')
    warnings.push('Texto com múltiplos tamanhos: não existe uma única classe text-* para todo o node.');
  if (typeof node.fontWeight === 'symbol')
    warnings.push('Texto com múltiplos pesos: use spans separados para preservar cada peso.');
  if (typeof node.lineHeight === 'symbol')
    warnings.push('Texto com múltiplos line-heights: conversão única não é segura.');
  if (typeof node.letterSpacing === 'symbol')
    warnings.push('Texto com múltiplos letter-spacings: nenhuma classe tracking-* global foi gerada.');
  if (typeof node.textDecoration === 'symbol')
    warnings.push('Texto com múltiplas decorações: use spans separados para preservar cada trecho.');
  if (typeof node.textCase === 'symbol')
    warnings.push('Texto com múltiplas transformações de caixa: nenhuma classe global foi gerada.');
  return warnings;
}

function renderingWarnings(node: SceneNode): string[] {
  const warnings: string[] = [];
  if (
    'strokeAlign' in node &&
    'strokes' in node &&
    Array.isArray(node.strokes) &&
    node.strokes.some((stroke) => stroke.visible !== false && (stroke.opacity ?? 1) > 0.001) &&
    node.strokeAlign !== 'INSIDE'
  )
    warnings.push(
      `Stroke alinhado em ${node.strokeAlign.toLowerCase()}: bordas CSS usam um modelo diferente e podem alterar alguns pixels.`
    );
  if ('blendMode' in node && node.blendMode !== 'NORMAL' && node.blendMode !== 'PASS_THROUGH')
    warnings.push(`Blend mode ${node.blendMode}: sem equivalente Tailwind direto e confiável.`);
  if ('isMask' in node && node.isMask)
    warnings.push('Máscara detectada: não existe conversão Tailwind direta para a geometria da máscara.');
  if ('rotation' in node && Math.abs(node.rotation % 360) > 0.01)
    warnings.push(
      `Rotação de ${Number(node.rotation.toFixed(2))}°: transformação não adicionada automaticamente para evitar diferenças de origem.`
    );
  if (hasComplexTransform(node))
    warnings.push(
      'Transformação com escala, skew ou reflexão: preserve o elemento como asset ou revise o CSS manualmente.'
    );
  return warnings;
}

export interface TextSegmentAnalysis {
  items: TextSegmentInfo[];
  partial: boolean;
  warning?: string;
}

const textMetric = (value: LineHeight | LetterSpacing): string =>
  value.unit === 'AUTO' ? 'auto' : value.unit === 'PIXELS' ? `${value.value}px` : `${value.value}%`;

function segmentClasses(
  segment: Pick<
    StyledTextSegment,
    | 'fontName'
    | 'fontSize'
    | 'fontWeight'
    | 'fontStyle'
    | 'fills'
    | 'lineHeight'
    | 'letterSpacing'
    | 'textDecoration'
    | 'textCase'
  >,
  fill: SolidPaint | undefined,
  settings: Settings
): string[] {
  const conversions: Conversion[] = [];
  const explicitLineHeight = segment.lineHeight.unit !== 'AUTO';
  conversions.push(fontSize(segment.fontSize, settings, explicitLineHeight));
  conversions.push(fontWeight(segment.fontWeight));
  conversions.push(fontFamily(segment.fontName.family));
  if (fill) conversions.push(paintColor('text', paintRgba(fill), settings));
  if (segment.lineHeight.unit !== 'AUTO')
    conversions.push(lineHeight(segment.lineHeight.value, segment.lineHeight.unit, settings));
  const tracking = letterSpacing(segment.letterSpacing.value, segment.letterSpacing.unit, settings);
  if (tracking) conversions.push(tracking);
  if (segment.fontStyle === 'ITALIC')
    conversions.push({ category: 'typography', property: 'font style', value: 'italic', classes: ['italic'] });
  if (segment.textDecoration === 'UNDERLINE')
    conversions.push({ category: 'typography', property: 'decoration', value: 'underline', classes: ['underline'] });
  if (segment.textDecoration === 'STRIKETHROUGH')
    conversions.push({
      category: 'typography',
      property: 'decoration',
      value: 'line-through',
      classes: ['line-through']
    });
  const textCases: Readonly<Record<string, string>> = {
    UPPER: 'uppercase',
    LOWER: 'lowercase',
    TITLE: 'capitalize'
  };
  const textCase = textCases[segment.textCase];
  if (textCase)
    conversions.push({
      category: 'typography',
      property: 'text transform',
      value: segment.textCase,
      classes: [textCase]
    });
  return sortedClasses(conversions);
}

export function analyzeTextSegments(
  node: TextNode,
  maxSegments: number,
  maxCharacters: number,
  settings: Settings = DEFAULT_SETTINGS
): TextSegmentAnalysis {
  const mixed = [
    node.fontName,
    node.fontSize,
    node.fontWeight,
    node.fills,
    node.lineHeight,
    node.letterSpacing,
    node.textDecoration,
    node.textCase
  ].some((value) => typeof value === 'symbol');
  if (!mixed) return { items: [], partial: false };
  const end = Math.min(node.characters.length, maxCharacters);
  const segmentLimit = Math.max(0, Math.floor(maxSegments));
  if (!segmentLimit || !end)
    return {
      items: [],
      partial: node.characters.length > 0,
      ...(node.characters.length > 0 ? { warning: 'Texto parcialmente analisado: limite de segmentos atingido.' } : {})
    };
  try {
    const fields: Array<
      | 'fontName'
      | 'fontSize'
      | 'fontWeight'
      | 'fontStyle'
      | 'fills'
      | 'lineHeight'
      | 'letterSpacing'
      | 'textDecoration'
      | 'textCase'
    > = [
      'fontName',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'fills',
      'lineHeight',
      'letterSpacing',
      'textDecoration',
      'textCase'
    ];
    const segments: Array<
      Pick<
        StyledTextSegment,
        | 'characters'
        | 'start'
        | 'end'
        | 'fontName'
        | 'fontSize'
        | 'fontWeight'
        | 'fontStyle'
        | 'fills'
        | 'lineHeight'
        | 'letterSpacing'
        | 'textDecoration'
        | 'textCase'
      >
    > = [];
    const chunkSize = 4_096;
    let cursor = 0,
      segmentLimitReached = false;
    while (cursor < end && segments.length < segmentLimit) {
      const chunkEnd = Math.min(end, cursor + chunkSize);
      const chunk = node.getStyledTextSegments(fields, cursor, chunkEnd);
      const allowance = segmentLimit - segments.length;
      segments.push(...chunk.slice(0, allowance));
      if (chunk.length > allowance) {
        segmentLimitReached = true;
        break;
      }
      cursor = chunkEnd;
    }
    if (cursor < end && segments.length >= segmentLimit) segmentLimitReached = true;
    const partial = node.characters.length > end || segmentLimitReached;
    const items = segments.map((segment) => {
      const fill = Array.isArray(segment.fills)
        ? segment.fills.find((paint): paint is SolidPaint => paint.type === 'SOLID' && paint.visible !== false)
        : undefined;
      const text = segment.characters.length > 120 ? `${segment.characters.slice(0, 117)}…` : segment.characters;
      return {
        text,
        start: segment.start,
        end: segment.end,
        classes: segmentClasses(segment, fill, settings),
        fontFamily: segment.fontName.family,
        fontSize: segment.fontSize,
        fontWeight: segment.fontWeight,
        ...(fill ? { color: toHex({ ...fill.color, a: fill.opacity ?? 1 }) } : {}),
        lineHeight: textMetric(segment.lineHeight),
        letterSpacing: textMetric(segment.letterSpacing),
        decoration: segment.textDecoration,
        textCase: segment.textCase
      };
    });
    return {
      items,
      partial,
      ...(partial ? { warning: 'Texto parcialmente analisado: limite de caracteres ou segmentos atingido.' } : {})
    };
  } catch {
    return { items: [], partial: true, warning: 'Não foi possível analisar os segmentos tipográficos deste texto.' };
  }
}

export interface ParseNodeOptions {
  depth?: number;
  includeChildren?: boolean;
  includeStructure?: boolean;
}
export interface SafeParseResult {
  result?: ParsedNode;
  error?: string;
}

const nodeLabel = (node: SceneNode): { name: string; dimensions: string } => {
  try {
    return { name: node.name || 'Sem nome', dimensions: `${Math.round(node.width)} × ${Math.round(node.height)}` };
  } catch {
    return { name: 'Elemento indisponível', dimensions: '—' };
  }
};

function collectVisibleChildren(
  children: readonly SceneNode[],
  maximumChecks: number
): { nodes: SceneNode[]; inaccessible: number; unchecked: number } {
  const nodes: SceneNode[] = [];
  let inaccessible = 0;
  const checked = Math.min(children.length, Math.max(0, maximumChecks));
  for (let index = 0; index < checked; index += 1) {
    const child = children[index];
    if (!child) continue;
    try {
      if (child.visible) nodes.push(child);
    } catch {
      inaccessible += 1;
      logger.warn('child-visibility-read-failed');
    }
  }
  return { nodes, inaccessible, unchecked: Math.max(0, children.length - checked) };
}

function failedNode(node: SceneNode, error: string): ParsedNode {
  const label = nodeLabel(node);
  return {
    id: node.id,
    name: label.name,
    type: node.type,
    dimensions: label.dimensions,
    classes: [],
    conversions: [],
    groups: [],
    unsupported: ['Não foi possível analisar este elemento.'],
    children: [],
    isVector: VECTOR_TYPES.has(node.type),
    structure: null,
    analysisLimited: false,
    parseError: error,
    detailsLoaded: true
  };
}

export function safeParseNode(
  node: SceneNode,
  settings: Settings,
  budget: AnalysisBudget,
  options: ParseNodeOptions = {}
): SafeParseResult {
  if (!budget.tryNode()) return { error: 'Limite de análise atingido.' };
  try {
    return { result: parseNodeInternal(node, settings, budget, options) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro inesperado durante a análise.';
    logger.warn('node-parse-failed', { nodeId: node.id, nodeType: node.type });
    return { result: failedNode(node, message), error: message };
  }
}

export function parseNode(
  node: SceneNode,
  settings: Settings,
  options: ParseNodeOptions = {},
  budget = new AnalysisBudget()
): ParsedNode {
  return safeParseNode(node, settings, budget, options).result ?? failedNode(node, 'Limite de análise atingido.');
}

function parseNodeInternal(
  node: SceneNode,
  settings: Settings,
  budget: AnalysisBudget,
  options: ParseNodeOptions
): ParsedNode {
  const depth = options.depth ?? 0,
    includeChildren = options.includeChildren ?? true,
    includeStructure = options.includeStructure ?? true;
  const conversions: Conversion[] = [];
  const unsupported: string[] = [];
  conversions.push(
    ...autoLayout(node as SceneNode & MinimalFillsMixin, settings),
    ...gridItem(node),
    ...clipping(node),
    ...positioningContext(node)
  );
  const snapshot = snapshotNode(node);
  const parentLayoutMode = snapshot.parentLayoutMode;
  conversions.push(...nodeDimensions(node, settings, parentLayoutMode));
  if ('minWidth' in node && typeof node.minWidth === 'number' && Number.isFinite(node.minWidth) && node.minWidth > 0)
    conversions.push(dimension('min-width', node.minWidth, settings));
  if ('maxWidth' in node && typeof node.maxWidth === 'number' && Number.isFinite(node.maxWidth) && node.maxWidth > 0)
    conversions.push(dimension('max-width', node.maxWidth, settings));
  if (
    'minHeight' in node &&
    typeof node.minHeight === 'number' &&
    Number.isFinite(node.minHeight) &&
    node.minHeight > 0
  )
    conversions.push(dimension('min-height', node.minHeight, settings));
  if (
    'maxHeight' in node &&
    typeof node.maxHeight === 'number' &&
    Number.isFinite(node.maxHeight) &&
    node.maxHeight > 0
  )
    conversions.push(dimension('max-height', node.maxHeight, settings));
  if ('paddingTop' in node)
    conversions.push(...padding(node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft, settings));
  conversions.push(
    ...fillConversions(node, settings),
    ...strokeConversions(node, settings),
    ...nonBoxStrokeWidth(node),
    ...borders(node, settings),
    ...imageConversion(node)
  );
  const parent =
    node.parent && 'width' in node.parent && 'height' in node.parent
      ? { width: node.parent.width, height: node.parent.height }
      : undefined;
  const positionResult = positioning(node, settings, parent);
  conversions.push(...positionResult.converted);
  unsupported.push(...positionResult.unsupported);
  unsupported.push(...unsupportedPaints(node));
  unsupported.push(...unsupportedStrokes(node));
  unsupported.push(...imagePaintWarnings(node));
  unsupported.push(...renderingWarnings(node));
  if (node.type === 'TEXT') {
    conversions.push(...typography(node, settings));
    unsupported.push(...mixedTypographyWarnings(node));
    if (node.characters.length > MAX_CODEGEN_TEXT_CHARACTERS)
      unsupported.push(
        `Código montado: texto limitado aos primeiros ${MAX_CODEGEN_TEXT_CHARACTERS.toLocaleString('pt-BR')} caracteres.`
      );
  }
  const segmentAnalysis =
    node.type === 'TEXT'
      ? analyzeTextSegments(node, budget.limits.maxTextSegments, budget.limits.maxTextCharactersAnalyzed, settings)
      : { items: [], partial: false };
  if (segmentAnalysis.warning) unsupported.push(segmentAnalysis.warning);
  const effectResult = effects(node, settings);
  conversions.push(...effectResult.converted);
  unsupported.push(...effectResult.unsupported);
  if ('opacity' in node) {
    const value = opacity(node.opacity);
    if (value) conversions.push(value);
  }
  if (VECTOR_TYPES.has(node.type)) unsupported.push('Elemento vetorial: o desenho não é convertido em Tailwind.');
  const rawChildren = 'children' in node ? node.children : [];
  const visible = collectVisibleChildren(rawChildren, Math.max(100, budget.limits.maxChildrenPerNode * 4));
  if (visible.inaccessible) {
    budget.registerSkipped(visible.inaccessible);
    unsupported.push(`${visible.inaccessible} filho(s) ficaram indisponíveis durante a análise.`);
  }
  if (visible.unchecked) {
    budget.registerSkipped(visible.unchecked);
    unsupported.push(
      `${visible.unchecked} filhos diretos não tiveram a visibilidade consultada porque o limite seguro foi atingido.`
    );
  }
  const allowance = includeChildren || includeStructure ? budget.childAllowance(visible.nodes.length, depth) : 0;
  const sampledChildren = allowance > 0 ? visible.nodes.slice(0, allowance) : [];
  const children: ParsedNode[] = [];
  if (includeChildren)
    for (const [index, child] of sampledChildren.entries()) {
      const parsed = safeParseNode(child, settings, budget, { ...options, depth: depth + 1 });
      if (parsed.result) children.push(parsed.result);
      else {
        // The allowance is calculated before recursive descendants consume the
        // shared budget. Stop here and account for direct siblings that can no
        // longer be parsed instead of silently omitting them.
        budget.registerSkipped(sampledChildren.length - index);
        break;
      }
    }
  const omittedDirectChildren = includeChildren
    ? Math.max(0, visible.nodes.length - children.length)
    : Math.max(0, visible.nodes.length - allowance);
  const localLimited = (includeChildren || includeStructure) && omittedDirectChildren > 0;
  if (localLimited)
    unsupported.push(
      allowance === 0 && visible.nodes.length > 0
        ? `Analysis truncated at depth ${depth + 1} because the selection is too complex; ${visible.nodes.length} filho(s) não foram percorridos.`
        : `Análise parcial: ${omittedDirectChildren} filho(s) visíveis fora do limite de performance.`
    );
  const structureAllowance = includeStructure && !localLimited ? budget.structureAllowance(sampledChildren.length) : 0;
  const canAnalyzeStructure = includeStructure && !localLimited && structureAllowance === sampledChildren.length;
  if (includeStructure && !canAnalyzeStructure && visible.nodes.length > 1)
    unsupported.push('Estrutura visual não analisada por limite de performance.');
  const normalized = canAnalyzeStructure ? normalizeStructure(node, sampledChildren) : null;
  if (canAnalyzeStructure && !normalized && sampledChildren.length > 1)
    unsupported.push('Estrutura visual não analisada porque a geometria de uma camada ficou indisponível ou inválida.');
  const baseStructure = normalized
    ? analyzeStructure(normalized, settings, structureConfigFromSettings(settings))
    : null;
  const nestedGroups = children.flatMap((child) => {
    const childStructure = child.structure;
    if (
      child.children.length < 2 ||
      !childStructure ||
      childStructure.type === 'unknown' ||
      childStructure.confidence < settings.minimumStructureConfidence
    )
      return [];
    return [
      {
        name: child.name,
        nodeIds: child.children.map((item) => item.id),
        nodeNames: child.children.map((item) => item.name),
        suggestedClasses: childStructure.classes,
        confidence: childStructure.confidence
      }
    ];
  });
  const structure = baseStructure
    ? {
        ...baseStructure,
        groups: [
          ...baseStructure.groups,
          ...nestedGroups.filter(
            (group) => !baseStructure.groups.some((existing) => existing.nodeIds.includes(group.nodeIds[0] ?? ''))
          )
        ]
      }
    : null;
  const enriched = conversions.map((item) => ({ ...item, fidelity: item.fidelity ?? conversionFidelity(item) }));
  const label = nodeLabel(node);
  const parsed: ParsedNode = {
    id: node.id,
    name: label.name,
    type: node.type,
    dimensions: label.dimensions,
    classes: sortedClasses(enriched),
    conversions: enriched,
    groups: groupConversions(enriched),
    unsupported,
    children,
    isVector: VECTOR_TYPES.has(node.type),
    structure,
    analysisLimited: localLimited || segmentAnalysis.partial || visible.unchecked > 0 || visible.inaccessible > 0,
    textSegments: segmentAnalysis.items,
    detailsLoaded: includeChildren && includeStructure,
    codegen: codegenMetadata(node)
  };
  parsed.suggestions = responsiveSuggestions(parsed);
  return parsed;
}
