import type {
  CodegenTextList,
  CodegenTextListItem,
  NodeCodegenMetadata,
  ParsedNode,
  ResponsiveCompareOverrides,
  Settings,
  SmartAnalysisResult,
  TextSegmentInfo
} from '../types';
import { padding } from '../converters/spacing';
import { arbitraryFontFamilyClass } from './arbitraryValues';
import { formatOutputClasses } from './nodeTreeFormatter';
import { responsiveVariantAttempt } from './responsiveVariants';
import { utility } from './tailwindScale';
import { componentNeedsReview, mergeComponentAttention, type ComponentAttention } from './componentAttention';
import { analyzeSemantics } from '../smart/semanticAnalyzer';
import { classAttribute, escapeJsxText, safeHyperlinkHref, stringAttribute } from '../codegen/jsxSafety';
import { componentName, componentWithProps, indentCode } from '../codegen/propsGenerator';
import { analyzeSmartNodes } from '../smart/smartPipeline';
import { assetName, inferredImageAlt, resolvedImageUsage } from '../codegen/assetResolver';

export type ComponentLayoutMode = 'leaf' | 'flow' | 'absolute';
export type ComponentOutputMode = 'faithful' | 'responsive' | 'component';
type TextElementTag = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
type SemanticContainerTag =
  'button' | 'a' | 'nav' | 'header' | 'main' | 'section' | 'footer' | 'article' | 'aside' | 'form';

export interface ComponentCodeOptions {
  mode?: ComponentOutputMode;
  assetPrefix?: string;
  responsiveOverrides?: ResponsiveCompareOverrides;
}

export interface ComponentCodeResult {
  code: string;
  layout: ComponentLayoutMode;
  notes: string[];
  reasons: string[];
  confidence: number;
  reviewRequired: boolean;
  attention: ComponentAttention;
  mode: ComponentOutputMode;
  responsiveStrategy?: 'fluid' | 'media-query';
}

interface BackgroundMerge {
  nodeId: string;
  classes: string[];
}

interface SimpleCardPlan {
  media: ParsedNode;
  mediaPlacement: 'full-bleed' | 'inset';
  mediaOrder: 'before' | 'after';
  mediaGap: number;
  content: ParsedNode[];
  padding: { top: number; right: number; bottom: number; left: number };
  gaps: number[];
}

interface RenderContext {
  notes: Set<string>;
  reasons: Set<string>;
  attention: ComponentAttention;
  assetCounts: Map<string, number>;
  assetPrefix?: string;
  outputMode: ComponentOutputMode;
  componentHrefProp: boolean;
}

function requireAttention(
  context: RenderContext,
  attention: Exclude<ComponentAttention, 'ready'>,
  note?: string
): void {
  context.attention = mergeComponentAttention(context.attention, attention);
  if (note) context.notes.add(note);
}

interface SemanticContainer {
  tag: SemanticContainerTag;
  attributes: string;
  reason: string;
  consumedHyperlink?: string;
  accessibilityReview?: string;
}

interface SemanticFormField {
  tag: 'input' | 'textarea';
  inputType?: 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';
  placeholder: string;
  ariaLabel: string;
  textNode: ParsedNode;
  confidence: number;
}

interface RenderBinding {
  textExpression?: 'title' | 'description';
  imageSrcExpression?: 'imageSrc';
  imageAltExpression?: 'imageAlt';
}

interface TextListTreeItem {
  item: CodegenTextListItem;
  children: TextListTreeItem[];
}

const DIMENSION_CLASS = /^(?:size|w|h|min-w|max-w|min-h|max-h)-/;
const VISUAL_CLASS = /^(?:bg-|border(?:-|$)|outline(?:-|$)|rounded(?:-|$)|shadow(?:-|$)|ring(?:-|$))/;
const POSITION_CLASS =
  /^(?:static|fixed|absolute|relative|sticky|z-|inset(?:-|$)|top-|right-|bottom-|left-|-inset-|-top-|-right-|-bottom-|-left-)/;
const HORIZONTAL_POSITION_CLASS = /^(?:left-|right-|-left-|-right-|inset(?:-x)?-|-inset(?:-x)?-)/;
const VERTICAL_POSITION_CLASS = /^(?:top-|bottom-|-top-|-bottom-|inset(?:-y)?-|-inset(?:-y)?-)/;
const STRUCTURE_CLASS =
  /^(?:block|inline|inline-block|flex(?:-|$)|grid(?:-|$)|items-|justify-|content-|place-|gap(?:-|$)|grow|shrink)/;
const HEIGHT_CLASS = /^(?:size|h|min-h|max-h)-/;
const RESPONSIVE_BLOCKING_WARNING =
  /(?:máscara|mask|blend mode|progressiv|stroke alinhado|rotação|transformação|imagepaint (?:rotacionado|com filtros)|gradiente|fills combinados|múltiplos (?:fills|strokes|efeitos)|sombra não convertida)/i;
const NON_NESTABLE_LANDMARKS = new Set<SemanticContainerTag>(['header', 'footer', 'nav', 'main', 'form']);
const FULL_BLEED_CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'INSTANCE']);
const RESPONSIVE_VARIANT_CLASS = /^(?:sm|md|lg|xl|2xl):/;
const INHERITABLE_TEXT_CLASS = [
  /^font-\['/,
  /^font-(?:sans|serif|mono)$/,
  /^text-(?:left|center|right|justify)$/,
  /^text-(?:white|black|transparent|current|inherit)$/,
  /^text-\[(?:#|rgba?\(|hsla?\(|oklch\()/,
  /^text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/
];
const FONT_SIZE_RANK: Readonly<Record<string, number>> = {
  'text-xs': 12,
  'text-sm': 14,
  'text-base': 16,
  'text-lg': 18,
  'text-xl': 20,
  'text-2xl': 24,
  'text-3xl': 30,
  'text-4xl': 36,
  'text-5xl': 48,
  'text-6xl': 60,
  'text-7xl': 72,
  'text-8xl': 96,
  'text-9xl': 128
};
const FONT_WEIGHT_RANK: Readonly<Record<string, number>> = {
  'font-thin': 100,
  'font-extralight': 200,
  'font-light': 300,
  'font-normal': 400,
  'font-medium': 500,
  'font-semibold': 600,
  'font-bold': 700,
  'font-extrabold': 800,
  'font-black': 900
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function optimizedClassValues(node: ParsedNode, values: readonly string[], settings: Settings): string[] {
  const isolated: ParsedNode = { ...node, classes: unique(values), children: [] };
  return formatOutputClasses(isolated, settings).split(' ').filter(Boolean);
}

function classListWithBase(
  node: ParsedNode,
  base: readonly string[],
  settings: Settings,
  extras: readonly string[]
): string[] {
  if (!extras.length) return [...base];
  const optimizedExtras = optimizedClassValues(node, extras, settings);
  const position = optimizedExtras.filter((value) => POSITION_CLASS.test(value));
  const structure = optimizedExtras.filter((value) => STRUCTURE_CLASS.test(value));
  const remaining = optimizedExtras.filter((value) => !POSITION_CLASS.test(value) && !STRUCTURE_CLASS.test(value));
  return unique([...structure, ...position, ...base, ...remaining]);
}

function classList(node: ParsedNode, settings: Settings, extras: readonly string[] = []): string[] {
  const base = optimizedClassValues(node, node.classes, settings);
  return classListWithBase(node, base, settings, extras);
}

function approximately(left: number, right: number, tolerance = 0.75): boolean {
  return Math.abs(left - right) <= tolerance;
}

function visualKind(value: string): string | null {
  if (value.startsWith('bg-')) return 'background';
  if (value.startsWith('rounded')) return 'radius';
  if (value.startsWith('shadow')) return 'shadow';
  if (value.startsWith('border') || value.startsWith('outline') || value.startsWith('ring')) return 'stroke';
  return null;
}

type RadiusScope = 'all' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'other';

function radiusDescriptor(value: string): { scope: RadiusScope; suffix: string } | null {
  const prefixes: ReadonlyArray<readonly [string, RadiusScope]> = [
    ['rounded-tl', 'top-left'],
    ['rounded-tr', 'top-right'],
    ['rounded-bl', 'bottom-left'],
    ['rounded-br', 'bottom-right'],
    ['rounded-t', 'top'],
    ['rounded-b', 'bottom'],
    ['rounded', 'all']
  ];
  for (const [prefix, scope] of prefixes) {
    if (value === prefix) return { scope, suffix: '' };
    if (value.startsWith(`${prefix}-`)) return { scope, suffix: value.slice(prefix.length + 1) };
  }
  return value.startsWith('rounded-') ? { scope: 'other', suffix: value.slice('rounded-'.length) } : null;
}

function rootClipsEquivalentMediaRadius(mediaClass: string, rootClasses: readonly string[]): boolean {
  if (!rootClasses.includes('overflow-hidden')) return false;
  const media = radiusDescriptor(mediaClass);
  if (!media || media.scope === 'all' || media.scope === 'other') return false;
  return rootClasses.some((value) => {
    const root = radiusDescriptor(value);
    if (!root || root.suffix !== media.suffix) return false;
    if (root.scope === 'all' || root.scope === media.scope) return true;
    if (media.scope === 'top' || media.scope === 'bottom') return false;
    if (media.scope === 'top-left' || media.scope === 'top-right') return root.scope === 'top';
    return root.scope === 'bottom';
  });
}

function hasUnsafeResponsiveVisual(node: ParsedNode): boolean {
  if (node.parseError || node.analysisLimited) return true;
  if (node.unsupported.some((warning) => RESPONSIVE_BLOCKING_WARNING.test(warning))) return true;
  return node.conversions.some(
    (conversion) =>
      (conversion.fidelity === 'unsupported' || conversion.fidelity === 'approximation') &&
      ['layout', 'position', 'dimensions', 'spacing', 'background', 'border', 'effects'].includes(conversion.category)
  );
}

function fullBleedBackground(node: ParsedNode, settings: Settings): BackgroundMerge | null {
  if (
    !FULL_BLEED_CONTAINER_TYPES.has(node.type) ||
    node.children.length < 2 ||
    !node.codegen ||
    hasUnsafeResponsiveVisual(node)
  )
    return null;
  const candidate = node.children[0];
  if (
    !candidate?.codegen ||
    candidate.type === 'TEXT' ||
    candidate.children.length > 0 ||
    candidate.codegen.imageScaleMode ||
    candidate.codegen.complexTransform ||
    Math.abs(candidate.codegen.rotation) > 0.01 ||
    candidate.unsupported.length > 0
  )
    return null;
  const box = candidate.codegen;
  if (
    !approximately(box.x, 0) ||
    !approximately(box.y, 0) ||
    !approximately(box.width, node.codegen.width) ||
    !approximately(box.height, node.codegen.height)
  )
    return null;
  const classes = classList(candidate, settings);
  const responsiveClasses = classes.filter((value) => RESPONSIVE_VARIANT_CLASS.test(value));
  if (responsiveClasses.some((value) => !value.endsWith(':hidden'))) return null;
  const baseClasses = classes.filter((value) => !RESPONSIVE_VARIANT_CLASS.test(value));
  if (!baseClasses.some((value) => VISUAL_CLASS.test(value))) return null;
  if (baseClasses.some((value) => !VISUAL_CLASS.test(value) && !DIMENSION_CLASS.test(value))) return null;
  const parentKinds = new Set(
    classList(node, settings)
      .map(visualKind)
      .filter((value): value is string => value !== null)
  );
  const candidateKinds = baseClasses.map(visualKind).filter((value): value is string => value !== null);
  if (candidateKinds.some((kind) => parentKinds.has(kind))) return null;
  return { nodeId: candidate.id, classes: baseClasses.filter((value) => VISUAL_CLASS.test(value)) };
}

function simpleCardPlan(node: ParsedNode, background: BackgroundMerge | null): SimpleCardPlan | null {
  if (
    !node.codegen ||
    hasUnsafeResponsiveVisual(node) ||
    node.codegen.layoutMode !== 'NONE' ||
    node.codegen.imageScaleMode ||
    node.codegen.complexTransform ||
    Math.abs(node.codegen.rotation) > 0.01
  )
    return null;
  const children = node.children.filter((child) => child.id !== background?.nodeId);
  const mediaCandidates = children.filter(
    (child) =>
      child.codegen?.imageScaleMode !== undefined &&
      resolvedImageUsage(child) === 'image-element' &&
      ['FILL', 'FIT'].includes(child.codegen.imageScaleMode) &&
      child.children.length === 0
  );
  if (mediaCandidates.length !== 1) return null;
  const media = mediaCandidates[0]!;
  const content = children
    .filter((child) => child.id !== media.id)
    .sort((first, second) => (first.codegen?.y ?? 0) - (second.codegen?.y ?? 0));
  if (content.length < 1 || content.some((child) => child.type !== 'TEXT' || child.children.length > 0)) return null;
  if (
    children.some(
      (child) =>
        !child.codegen ||
        hasUnsafeResponsiveVisual(child) ||
        child.codegen.complexTransform ||
        Math.abs(child.codegen.rotation) > 0.01
    )
  )
    return null;
  const rootBox = node.codegen;
  const mediaBox = media.codegen!;
  const first = content[0]!.codegen!;
  const last = content[content.length - 1]!.codegen!;
  const mediaBefore = mediaBox.y + mediaBox.height <= first.y + 0.75;
  const mediaAfter = mediaBox.y >= last.y + last.height - 0.75;
  if (mediaBefore === mediaAfter) return null;
  const mediaOrder: SimpleCardPlan['mediaOrder'] = mediaBefore ? 'before' : 'after';
  const horizontallyFullBleed = approximately(mediaBox.x, 0) && approximately(mediaBox.width, rootBox.width);
  const fullBleedMedia =
    horizontallyFullBleed &&
    (mediaOrder === 'before'
      ? approximately(mediaBox.y, 0)
      : approximately(mediaBox.y + mediaBox.height, rootBox.height));
  const insetMedia =
    mediaBox.x >= -0.75 && approximately(mediaBox.x, first.x) && approximately(mediaBox.width, first.width);
  if ((!fullBleedMedia && !insetMedia) || mediaBox.height <= 0 || mediaBox.height >= rootBox.height) return null;
  if (
    content.some(
      (child) =>
        !approximately(child.codegen!.x, first.x) ||
        !approximately(child.codegen!.width, first.width) ||
        child.codegen!.width <= 0 ||
        child.codegen!.height < 0
    )
  )
    return null;
  const gaps = content.slice(1).map((child, index) => {
    const previous = content[index]!.codegen!;
    return child.codegen!.y - (previous.y + previous.height);
  });
  if (gaps.some((value) => !Number.isFinite(value) || value < -0.75)) return null;
  const mediaGap =
    mediaOrder === 'before' ? first.y - (mediaBox.y + mediaBox.height) : mediaBox.y - (last.y + last.height);
  if (!Number.isFinite(mediaGap) || mediaGap < -0.75) return null;
  const boxPadding = {
    top: mediaOrder === 'before' ? (fullBleedMedia ? mediaGap : mediaBox.y) : first.y,
    right: rootBox.width - ((fullBleedMedia ? first : mediaBox).x + (fullBleedMedia ? first : mediaBox).width),
    bottom:
      mediaOrder === 'before'
        ? rootBox.height - (last.y + last.height)
        : fullBleedMedia
          ? mediaGap
          : rootBox.height - (mediaBox.y + mediaBox.height),
    left: fullBleedMedia ? first.x : mediaBox.x
  };
  if (Object.values(boxPadding).some((value) => !Number.isFinite(value) || value < -0.75)) return null;
  return {
    media,
    mediaPlacement: fullBleedMedia ? 'full-bleed' : 'inset',
    mediaOrder,
    mediaGap: Math.max(0, mediaGap),
    content,
    padding: {
      top: Math.max(0, boxPadding.top),
      right: Math.max(0, boxPadding.right),
      bottom: Math.max(0, boxPadding.bottom),
      left: Math.max(0, boxPadding.left)
    },
    gaps: gaps.map((value) => Math.max(0, value))
  };
}

function layoutMode(node: ParsedNode): ComponentLayoutMode {
  if (!node.children.length) return 'leaf';
  return node.codegen?.layoutMode !== undefined && node.codegen.layoutMode !== 'NONE' ? 'flow' : 'absolute';
}

function signedUtility(prefix: 'left' | 'top', value: number, settings: Settings): string {
  const converted = utility(prefix, Math.abs(value), settings);
  return value < 0 ? `-${converted}` : converted;
}

function implicitPosition(
  metadata: NodeCodegenMetadata | undefined,
  settings: Settings,
  own: readonly string[]
): string[] {
  const result = own.includes('absolute') ? [] : ['absolute'];
  if (!metadata) return result;
  if (!own.some((value) => HORIZONTAL_POSITION_CLASS.test(value)))
    result.push(signedUtility('left', metadata.x, settings));
  if (!own.some((value) => VERTICAL_POSITION_CLASS.test(value)))
    result.push(signedUtility('top', metadata.y, settings));
  return result;
}

function responsiveHorizontalStretch(
  metadata: NodeCodegenMetadata | undefined,
  settings: Settings,
  own: readonly string[]
): string[] | null {
  if (!metadata?.parentWidth || metadata.parentWidth <= 0 || metadata.width <= 0) return null;
  if (own.some((value) => /^(?:right-|inset(?:-x)?-|-right-|-inset(?:-x)?-)/.test(value))) return null;
  const left = metadata.x;
  const right = metadata.parentWidth - metadata.x - metadata.width;
  if (
    left < 0 ||
    right < 0 ||
    metadata.width / metadata.parentWidth < 0.75 ||
    Math.abs(left - right) > settings.alignmentTolerancePx
  )
    return null;
  return [utility('right', right, settings), 'w-auto'];
}

function boxesOverlap(first: ParsedNode, second: ParsedNode): boolean {
  const a = first.codegen,
    b = second.codegen;
  if (!a || !b) return true;
  const tolerance = 0.5;
  return !(
    a.x + a.width <= b.x + tolerance ||
    b.x + b.width <= a.x + tolerance ||
    a.y + a.height <= b.y + tolerance ||
    b.y + b.height <= a.y + tolerance
  );
}

function visualOrder(children: ParsedNode[]): ParsedNode[] {
  if (children.some((child) => child.codegen?.complexTransform || Math.abs(child.codegen?.rotation ?? 0) > 0.01))
    return children;
  const overlaps = children.some((child, index) =>
    children.slice(index + 1).some((candidate) => boxesOverlap(child, candidate))
  );
  if (overlaps) return children;
  return [...children].sort(
    (first, second) =>
      (first.codegen?.y ?? 0) - (second.codegen?.y ?? 0) || (first.codegen?.x ?? 0) - (second.codegen?.x ?? 0)
  );
}

function assetPath(node: ParsedNode, context: RenderContext): string {
  const base = assetName(node.name);
  const scopedBase = context.assetPrefix ? `${context.assetPrefix}-${base}` : base;
  const imageCount = [...context.assetCounts.values()].reduce((total, count) => total + count, 0);
  // A seleção já fornece um prefixo único por card. Quando existe somente
  // uma imagem, repetir também o nome da camada (normalmente "Rectangle 250")
  // deixa o caminho longo sem acrescentar informação ou evitar colisões.
  if (context.assetPrefix && imageCount === 1) return context.assetPrefix;
  if ((context.assetCounts.get(base) ?? 0) < 2) return scopedBase;
  const suffix = assetName(node.id).slice(-24);
  return `${scopedBase}-${suffix || 'asset'}`;
}

function inheritableTextClass(value: string): boolean {
  return INHERITABLE_TEXT_CLASS.some((pattern) => pattern.test(value));
}

function cleanTextClasses(node: ParsedNode, settings: Settings): string[] {
  return classList(node, settings).filter((value) => !POSITION_CLASS.test(value) && !DIMENSION_CLASS.test(value));
}

function commonTextClasses(content: ParsedNode[], settings: Settings): string[] {
  const lists = content.map((child) => cleanTextClasses(child, settings));
  const first = lists[0] ?? [];
  return first.filter(
    (value) => inheritableTextClass(value) && lists.slice(1).every((classes) => classes.includes(value))
  );
}

function explicitTextTag(name: string): TextElementTag | null {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const explicit =
    normalized.match(/(?:^|[^a-z0-9])h([1-6])(?:[^a-z0-9]|$)/)?.[1] ??
    normalized.match(/heading[\s_/-]*([1-6])(?:[^0-9]|$)/)?.[1];
  if (explicit) return `h${explicit}` as TextElementTag;
  if (/(?:page|pagina|hero)[\s_/-]*(?:title|titulo)|(?:title|titulo)[\s_/-]*(?:page|pagina|hero)/.test(normalized))
    return 'h1';
  if (/(?:section|secao)[\s_/-]*(?:title|titulo)|(?:title|titulo)[\s_/-]*(?:section|secao)/.test(normalized))
    return 'h2';
  if (
    /(?:card|item|product|produto)[\s_/-]*(?:title|titulo)|(?:title|titulo)[\s_/-]*(?:card|item|product|produto)/.test(
      normalized
    )
  )
    return 'h3';
  return null;
}

function normalizedSemanticName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sharedSafeDescendantHyperlink(node: ParsedNode): string | null {
  const stack = [...node.children];
  const hrefs = new Set<string>();
  let foundHyperlink = false;
  while (stack.length) {
    const current = stack.pop()!;
    stack.push(...current.children);
    const hyperlink = current.codegen?.hyperlink;
    if (!hyperlink) continue;
    foundHyperlink = true;
    if (hyperlink.type !== 'URL') return null;
    const href = safeHyperlinkHref(hyperlink.value);
    if (!href) return null;
    hrefs.add(href);
    if (hrefs.size > 1) return null;
  }
  return foundHyperlink ? ([...hrefs][0] ?? null) : null;
}

function hasMeaningfulButtonText(node: ParsedNode): boolean {
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop()!;
    stack.push(...current.children);
    if (current.type !== 'TEXT') continue;
    const text = textContent(current)?.trim() ?? '';
    if (/\p{L}|\p{N}/u.test(text)) return true;
  }
  return false;
}

function buttonAriaLabel(name: string): string | null {
  const ignored = new Set([
    'button',
    'botao',
    'cta',
    'primary',
    'secondary',
    'tertiary',
    'icon',
    'icone',
    'component',
    'instance',
    'frame'
  ]);
  const words = name
    .replace(/[_/\\-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !ignored.has(normalizedSemanticName(word)));
  const label = words.join(' ').trim();
  return label.length >= 2 && label.length <= 120 ? label : null;
}

function descendantText(node: ParsedNode): string {
  const values: string[] = [];
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop()!;
    stack.push(...current.children);
    if (current.type === 'TEXT') {
      const value = textContent(current)?.trim();
      if (value) values.push(value);
    }
  }
  return values.join(' ');
}

function isSubmitButton(node: ParsedNode): boolean {
  const intent = normalizedSemanticName(`${node.name} ${descendantText(node)}`);
  return /(?:^| )(?:submit|send|enviar|entrar|login|cadastrar|cadastro|register|registrar|salvar|confirmar)(?: |$)/.test(
    intent
  );
}

function fieldAriaLabel(name: string, placeholder: string): string {
  const cleanedName = name
    .replace(/(?:input|field|campo|textarea|text area|control|controle)/gi, ' ')
    .replace(/[_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleanedName.length >= 2 && cleanedName.length <= 80) return cleanedName;
  return (
    placeholder
      .replace(/[.:…]+$/u, '')
      .trim()
      .slice(0, 120) || 'Campo'
  );
}

function semanticFormField(node: ParsedNode): SemanticFormField | null {
  if (node.type === 'TEXT' || node.children.length !== 1) return null;
  const textNode = node.children[0];
  if (!textNode || textNode.type !== 'TEXT' || textNode.children.length) return null;

  const placeholder = textContent(textNode)?.trim() ?? '';
  if (!placeholder || placeholder.length > 200 || placeholder.includes('\n')) return null;

  const name = normalizedSemanticName(node.name);
  const explicitIntent =
    /(?:^| )(?:input|field|campo|email|password|senha|search|busca|phone|telefone|tel|textarea|message|mensagem|url)(?: |$)/.test(
      name
    );
  if (!explicitIntent) return null;

  const width = node.codegen?.width ?? 0;
  const height = node.codegen?.height ?? 0;
  if (width < 100 || height < 28) return null;

  const smartDecision = analyzeSemantics(node);
  const hasVisualSurface = node.classes.some((value) => VISUAL_CLASS.test(value));
  const smartInput = smartDecision.type === 'input' && smartDecision.confidence >= 0.75;
  if (!hasVisualSurface && !smartInput) return null;

  const textareaIntent =
    /(?:^| )(?:textarea|message|mensagem|comentario|comment|descricao|description)(?: |$)/.test(name) || height >= 96;
  const inputType = /(?:^| )(?:email|e mail)(?: |$)/.test(name)
    ? 'email'
    : /(?:^| )(?:password|senha)(?: |$)/.test(name)
      ? 'password'
      : /(?:^| )(?:search|busca|pesquisa)(?: |$)/.test(name)
        ? 'search'
        : /(?:^| )(?:phone|telefone|tel|celular)(?: |$)/.test(name)
          ? 'tel'
          : /(?:^| )(?:url|website|site)(?: |$)/.test(name)
            ? 'url'
            : 'text';

  return {
    tag: textareaIntent ? 'textarea' : 'input',
    ...(textareaIntent ? {} : { inputType }),
    placeholder,
    ariaLabel: fieldAriaLabel(node.name, placeholder),
    textNode,
    confidence: smartInput ? smartDecision.confidence : 0.82
  };
}

function semanticContainer(node: ParsedNode): SemanticContainer | null {
  if (!node.children.length || node.type === 'TEXT') return null;
  const smartDecision = analyzeSemantics(node);
  const smartIsProbable = smartDecision.confidence >= 0.75;
  const name = normalizedSemanticName(node.name);
  const words = name.split(' ').filter(Boolean);
  const first = words[0] ?? '';
  const last = words[words.length - 1] ?? '';
  const buttonWords = new Set(['button', 'botao', 'cta']);
  const disallowedButtonPart = words.some((word) =>
    [
      'icon',
      'icone',
      'label',
      'text',
      'texto',
      'background',
      'fundo',
      'spinner',
      'loader',
      'card',
      'section',
      'secao'
    ].includes(word)
  );
  const buttonStructure =
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE' ||
    node.codegen?.layoutMode === 'HORIZONTAL' ||
    node.codegen?.layoutMode === 'VERTICAL';
  if (
    ((buttonWords.has(first) || buttonWords.has(last)) && !disallowedButtonPart && buttonStructure) ||
    (smartIsProbable && smartDecision.type === 'button')
  ) {
    const navigationHref = sharedSafeDescendantHyperlink(node);
    if (navigationHref)
      return {
        tag: 'a',
        attributes: stringAttribute('href', navigationHref),
        reason: `A camada “${node.name}” foi reconhecida como link visual porque sua estrutura de botão contém um hyperlink seguro.`,
        consumedHyperlink: navigationHref
      };
    const hasAccessibleText = hasMeaningfulButtonText(node);
    const suggestedLabel = hasAccessibleText ? null : buttonAriaLabel(node.name);
    return {
      tag: 'button',
      attributes: ` type="button"${suggestedLabel ? stringAttribute('aria-label', suggestedLabel) : ''}`,
      reason: `A camada “${node.name}” foi reconhecida como botão por evidências combinadas (${Math.round(smartDecision.confidence * 100)}% de confiança).`,
      ...(!hasAccessibleText
        ? {
            accessibilityReview: suggestedLabel
              ? `O aria-label “${suggestedLabel}” foi sugerido pelo nome do botão sem texto; confirme seu significado.`
              : 'Este botão não possui texto acessível nem um nome de camada descritivo; adicione aria-label antes de publicar.'
          }
        : {})
    };
  }

  const exactLandmarks: Readonly<Record<string, SemanticContainerTag>> = {
    header: 'header',
    cabecalho: 'header',
    'site header': 'header',
    'page header': 'header',
    footer: 'footer',
    rodape: 'footer',
    'site footer': 'footer',
    'page footer': 'footer',
    nav: 'nav',
    navigation: 'nav',
    navegacao: 'nav',
    'main navigation': 'nav',
    'primary navigation': 'nav',
    main: 'main',
    'main content': 'main',
    'conteudo principal': 'main',
    aside: 'aside',
    sidebar: 'aside',
    'barra lateral': 'aside',
    article: 'article',
    artigo: 'article',
    form: 'form',
    formulario: 'form',
    'contact form': 'form',
    'formulario de contato': 'form'
  };
  const landmark = exactLandmarks[name];
  if (landmark)
    return {
      tag: landmark,
      attributes: '',
      reason: `A camada “${node.name}” usa um nome semântico explícito e foi convertida para <${landmark}>.`
    };

  const smartTags: Partial<Record<typeof smartDecision.type, SemanticContainerTag>> = {
    navbar: 'nav',
    sidebar: 'aside',
    header: 'header',
    footer: 'footer',
    section: 'section',
    form: 'form'
  };
  const smartTag = smartTags[smartDecision.type];
  if (smartIsProbable && smartTag)
    return {
      tag: smartTag,
      attributes: '',
      reason: `A camada “${node.name}” foi convertida para <${smartTag}> por análise estrutural e semântica (${Math.round(smartDecision.confidence * 100)}%).`
    };

  if (
    smartIsProbable &&
    smartDecision.type === 'card' &&
    node.children.some((child) => child.type === 'TEXT') &&
    /(?:card|article|produto|product|post|item)/.test(name)
  )
    return {
      tag: 'article',
      attributes: '',
      reason: `A camada “${node.name}” foi reconhecida como conteúdo independente e convertida para <article> (${Math.round(smartDecision.confidence * 100)}%).`
    };

  const sectionNamed = last === 'section' || last === 'secao';
  const hasNamedHeading = node.children.some(
    (child) => child.type === 'TEXT' && explicitTextTag(child.name)?.startsWith('h')
  );
  if (sectionNamed && hasNamedHeading)
    return {
      tag: 'section',
      attributes: '',
      reason: `A camada “${node.name}” foi convertida para <section> porque possui nome de seção e heading explícito.`
    };
  return null;
}

function fontWeightRank(classes: readonly string[]): number {
  for (const className of classes) {
    const standard = FONT_WEIGHT_RANK[className];
    if (standard !== undefined) return standard;
    const arbitrary = className.match(/^font-\[(\d{3})\]$/)?.[1];
    if (arbitrary) return Number(arbitrary);
  }
  return 400;
}

function fontSizeRank(classes: readonly string[]): number {
  for (const className of classes) {
    const standard = FONT_SIZE_RANK[className];
    if (standard !== undefined) return standard;
    const arbitrary = className.match(/^text-\[(-?\d+(?:\.\d+)?)(px|rem)\](?:\/.*)?$/);
    if (arbitrary) return Number(arbitrary[1]) * (arbitrary[2] === 'rem' ? 16 : 1);
  }
  return 0;
}

function textContent(node: ParsedNode): string | null {
  if (typeof node.codegen?.text === 'string') return node.codegen.text;
  if (node.textSegments?.length && !node.analysisLimited)
    return node.textSegments.map((segment) => segment.text).join('');
  return null;
}

function inferredCardHeadingIndex(content: ParsedNode[], settings: Settings): number {
  if (content.length < 2 || content.some((child) => explicitTextTag(child.name) !== null)) return -1;
  const candidates = content
    .map((child, index) => {
      const text = textContent(child)?.trim() ?? '';
      const classes = cleanTextClasses(child, settings);
      return {
        index,
        valid: text.length > 0 && text.length <= 160 && !text.includes('\n'),
        size: fontSizeRank(classes),
        weight: fontWeightRank(classes)
      };
    })
    .filter((candidate) => candidate.valid && candidate.weight >= 600)
    .sort((left, right) => right.size - left.size || right.weight - left.weight || left.index - right.index);
  const strongest = candidates[0];
  if (!strongest) return -1;
  const hasWeakerBody = content.some((child, index) => {
    if (index === strongest.index) return false;
    const classes = cleanTextClasses(child, settings);
    return strongest.size > fontSizeRank(classes) || strongest.weight > fontWeightRank(classes);
  });
  return hasWeakerBody ? strongest.index : -1;
}

function cardTextTag(
  node: ParsedNode,
  index: number,
  content: ParsedNode[],
  settings: Settings
): { tag: TextElementTag; inferred: boolean } {
  const explicit = explicitTextTag(node.name);
  if (explicit) return { tag: explicit, inferred: false };
  return index === inferredCardHeadingIndex(content, settings)
    ? { tag: 'h2', inferred: true }
    : { tag: 'p', inferred: false };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.max(1, Math.abs(left));
  let b = Math.max(1, Math.abs(right));
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

function aspectClass(width: number, height: number): string {
  if (Number.isInteger(width) && Number.isInteger(height)) {
    const divisor = greatestCommonDivisor(width, height);
    return `aspect-[${width / divisor}/${height / divisor}]`;
  }
  return `aspect-[${Number((width / height).toFixed(6))}]`;
}

function supportsCardProps(plan: SimpleCardPlan | null, settings: Settings): plan is SimpleCardPlan {
  return (
    plan !== null &&
    plan.content.length === 2 &&
    cardTextTag(plan.content[0]!, 0, plan.content, settings).tag !== 'p' &&
    plan.content.every(
      (node) =>
        textContent(node) !== null &&
        !node.codegen?.textList &&
        !node.codegen?.textTruncated &&
        !node.analysisLimited &&
        (node.textSegments?.length ?? 0) === 0
    )
  );
}

function semanticCardTag(
  plan: SimpleCardPlan,
  node: ParsedNode,
  settings: Settings,
  context: RenderContext
): TextElementTag | undefined {
  const index = plan.content.findIndex((child) => child.id === node.id);
  if (index < 0) return undefined;
  const semantic = cardTextTag(node, index, plan.content, settings);
  if (semantic.inferred) {
    requireAttention(
      context,
      'semantic',
      'O primeiro texto do card foi sugerido como <h2> pela hierarquia visual; confirme o nível correto no contexto da página.'
    );
  }
  return semantic.tag;
}

function renderSimpleCard(
  node: ParsedNode,
  plan: SimpleCardPlan,
  settings: Settings,
  depth: number,
  context: RenderContext,
  classes: string[]
): string {
  const indent = '  '.repeat(depth);
  const semanticNode = semanticContainer(node);
  const cardSemanticNode = semanticNode?.tag === 'button' ? null : semanticNode;
  if (cardSemanticNode) context.reasons.add(cardSemanticNode.reason);
  if (semanticNode?.accessibilityReview) {
    requireAttention(context, 'semantic', semanticNode.accessibilityReview);
  }
  const responsiveRoot = depth === 0 && (context.outputMode === 'responsive' || context.outputMode === 'component');
  const widthMode = node.codegen?.widthMode ?? 'fixed';
  const clipsContent = node.codegen?.clipsContent ?? classes.includes('overflow-hidden');
  const hadSize = classes.some((value) => value.startsWith('size-'));
  const rootClasses = classes.filter(
    (value) =>
      value !== 'relative' &&
      value !== 'overflow-hidden' &&
      !HEIGHT_CLASS.test(value) &&
      (!responsiveRoot || !/^(?:w|min-w|max-w)-/.test(value))
  );
  if (responsiveRoot && widthMode === 'fixed')
    rootClasses.unshift('w-full', utility('max-w', node.codegen!.width, settings));
  else if (responsiveRoot && widthMode === 'auto') rootClasses.unshift('w-fit', 'max-w-full');
  else if (responsiveRoot && widthMode === 'fill') {
    if (rootClasses.includes('grow') || rootClasses.includes('self-stretch')) rootClasses.unshift('min-w-0');
    else rootClasses.unshift('w-full');
  } else if (hadSize && !rootClasses.some((value) => value.startsWith('w-')))
    rootClasses.unshift(utility('w', node.codegen!.width, settings));
  if (clipsContent) rootClasses.unshift('overflow-hidden');

  const mediaClasses = classList(plan.media, settings).filter(
    (value) =>
      !POSITION_CLASS.test(value) &&
      !DIMENSION_CLASS.test(value) &&
      (plan.mediaPlacement === 'inset' || !rootClipsEquivalentMediaRadius(value, rootClasses)) &&
      value !== 'block'
  );
  const inherited = commonTextClasses(plan.content, settings);
  const paddingClasses = padding(
    plan.padding.top,
    plan.padding.right,
    plan.padding.bottom,
    plan.padding.left,
    settings
  ).flatMap((item) => item.classes);
  const renderedGaps =
    plan.mediaPlacement === 'inset'
      ? plan.mediaOrder === 'before'
        ? [plan.mediaGap, ...plan.gaps]
        : [...plan.gaps, plan.mediaGap]
      : plan.gaps;
  const uniformGap =
    renderedGaps.length === 0 || renderedGaps.every((value) => approximately(value, renderedGaps[0] ?? 0));
  const sharedGap = uniformGap ? Math.max(0, renderedGaps[0] ?? 0) : 0;
  const media = {
    ...plan.media,
    classes: unique([
      ...(responsiveRoot
        ? [aspectClass(plan.media.codegen!.width, plan.media.codegen!.height), 'w-full']
        : ['w-full', utility('h', plan.media.codegen!.height, settings)]),
      ...mediaClasses,
      ...(plan.mediaPlacement === 'inset' && plan.mediaOrder === 'after' && !uniformGap && plan.mediaGap > 0
        ? [utility('mt', plan.mediaGap, settings)]
        : [])
    ])
  };
  const wrapperClasses = unique([
    ...(sharedGap > 0
      ? [utility(settings.outputProfile === 'optimized' ? 'space-y' : 'gap', sharedGap, settings)]
      : []),
    ...(settings.outputProfile === 'optimized' ? [] : ['flex', 'flex-col']),
    ...paddingClasses,
    ...inherited
  ]);
  const withProps = context.outputMode === 'component' && depth === 0 && supportsCardProps(plan, settings);
  const mediaCode = renderNode(
    media,
    settings,
    depth + (plan.mediaPlacement === 'inset' ? 2 : 1),
    false,
    context,
    [],
    undefined,
    withProps ? { imageSrcExpression: 'imageSrc', imageAltExpression: 'imageAlt' } : undefined
  );
  const textCode = plan.content
    .map((child, index) => {
      const gapBefore =
        index > 0
          ? (plan.gaps[index - 1] ?? 0)
          : plan.mediaPlacement === 'inset' && plan.mediaOrder === 'before'
            ? plan.mediaGap
            : 0;
      const textNode = {
        ...child,
        classes: unique([
          ...cleanTextClasses(child, settings).filter((value) => !inherited.includes(value)),
          ...(!uniformGap && gapBefore > 0 ? [utility('mt', gapBefore, settings)] : [])
        ])
      };
      const semanticTag = semanticCardTag(plan, child, settings, context) ?? 'p';
      const binding: RenderBinding | undefined = withProps
        ? { textExpression: index === 0 ? 'title' : 'description' }
        : undefined;
      return renderNode(
        textNode,
        settings,
        depth + 2,
        false,
        context,
        [],
        semanticTag,
        binding,
        false,
        [],
        cardSemanticNode?.consumedHyperlink
      );
    })
    .join('\n');
  context.notes.add(
    'A geometria deste card comprovou um fluxo vertical simples; offsets e dimensões repetidas foram substituídos por padding e gap.'
  );
  if (!uniformGap)
    context.notes.add('Espaçamentos diferentes no conteúdo foram preservados individualmente com margens.');
  if (plan.mediaPlacement === 'inset')
    context.notes.add('A imagem interna alinhada ao texto foi mantida no mesmo container de padding do card.');
  if (plan.mediaOrder === 'after')
    context.notes.add('A ordem imagem-após-conteúdo comprovada pela geometria foi preservada no fluxo do card.');
  if (responsiveRoot && widthMode !== 'fixed')
    context.notes.add(
      `A largura responsiva respeita o comportamento ${widthMode === 'auto' ? 'Hug Contents' : widthMode === 'fill' ? 'Fill Container' : 'Stretch'} do Figma.`
    );
  // Imagem, título e descrição formam conteúdo autônomo: article comunica
  // melhor a semântica e continua sendo um bloco copiável sem abstração React.
  const containerTag = cardSemanticNode?.tag ?? 'article';
  const containerAttributes =
    withProps && context.componentHrefProp ? ' href={href}' : withProps ? '' : (cardSemanticNode?.attributes ?? '');
  if (withProps)
    context.notes.add(
      `O card foi parametrizado com title, description, imageSrc e imageAlt${context.componentHrefProp ? ' e href' : ''} para reutilização em React.`
    );
  const wrapperContent =
    plan.mediaPlacement === 'inset'
      ? plan.mediaOrder === 'before'
        ? `${mediaCode}\n${textCode}`
        : `${textCode}\n${mediaCode}`
      : textCode;
  const wrapperCode = `${indent}  <div${classAttribute(wrapperClasses)}>\n${wrapperContent}\n${indent}  </div>`;
  const rootContent =
    plan.mediaPlacement === 'full-bleed'
      ? plan.mediaOrder === 'before'
        ? `${mediaCode}\n${wrapperCode}`
        : `${wrapperCode}\n${mediaCode}`
      : wrapperCode;
  return `${indent}<${containerTag}${containerAttributes}${classAttribute(unique(rootClasses))}>\n${rootContent}\n${indent}</${containerTag}>`;
}

function segmentClassList(node: ParsedNode, segment: TextSegmentInfo, settings: Settings): string[] {
  if (!segment.classes?.length) return [];
  const isolated: ParsedNode = {
    ...node,
    classes: segment.classes,
    conversions: segment.fontFamily
      ? [
          {
            category: 'typography',
            property: 'font family',
            value: segment.fontFamily,
            classes: [arbitraryFontFamilyClass(segment.fontFamily)],
            source: { fontFamily: segment.fontFamily }
          }
        ]
      : [],
    children: []
  };
  return formatOutputClasses(isolated, settings).split(' ').filter(Boolean);
}

function mixedTextContent(
  node: ParsedNode,
  text: string,
  parentClasses: readonly string[],
  settings: Settings,
  context: RenderContext
): string | null {
  const segments = (node.textSegments ?? [])
    .filter(
      (segment) =>
        Number.isInteger(segment.start) &&
        Number.isInteger(segment.end) &&
        (segment.start ?? -1) >= 0 &&
        (segment.end ?? -1) > (segment.start ?? -1)
    )
    .sort((first, second) => (first.start ?? 0) - (second.start ?? 0));
  if (!segments.length) return null;
  let cursor = 0;
  const parts: Array<{ text: string; classes: string[] }> = [];
  const append = (value: string, classes: string[] = []): void => {
    if (!value) return;
    const previous = parts[parts.length - 1];
    if (previous && previous.classes.join('\u0000') === classes.join('\u0000')) previous.text += value;
    else parts.push({ text: value, classes });
  };
  for (const segment of segments) {
    const start = Math.max(cursor, Math.min(text.length, segment.start ?? cursor));
    const end = Math.max(start, Math.min(text.length, segment.end ?? start));
    if (start > cursor) append(text.slice(cursor, start));
    if (end > start) {
      const classes = segmentClassList(node, segment, settings).filter((value) => !parentClasses.includes(value));
      append(text.slice(start, end), classes);
    }
    cursor = end;
    if (cursor >= text.length) break;
  }
  if (cursor < text.length) append(text.slice(cursor));
  if (node.analysisLimited || node.codegen?.textTruncated) {
    requireAttention(
      context,
      'review',
      'Os estilos de texto misto foram gerados somente para os segmentos analisados; revise o conteúdo restante.'
    );
  }
  return parts
    .map((part) =>
      part.classes.length
        ? `<span${classAttribute(part.classes)}>${escapeJsxText(part.text)}</span>`
        : escapeJsxText(part.text)
    )
    .join('');
}

function textListTree(list: CodegenTextList): TextListTreeItem[] | null {
  if (!list.items.length) return null;
  const rootLevel = list.items[0]!.indentationLevel;
  const roots: TextListTreeItem[] = [];
  const lastAtLevel = new Map<number, TextListTreeItem>();
  let previousLevel = rootLevel;
  for (const item of list.items) {
    if (
      !item.text ||
      !Number.isInteger(item.indentationLevel) ||
      item.indentationLevel < rootLevel ||
      item.indentationLevel > previousLevel + 1
    )
      return null;
    const treeItem: TextListTreeItem = { item, children: [] };
    if (item.indentationLevel === rootLevel) roots.push(treeItem);
    else {
      const parent = lastAtLevel.get(item.indentationLevel - 1);
      if (!parent) return null;
      parent.children.push(treeItem);
    }
    for (const level of [...lastAtLevel.keys()]) if (level >= item.indentationLevel) lastAtLevel.delete(level);
    lastAtLevel.set(item.indentationLevel, treeItem);
    previousLevel = item.indentationLevel;
  }
  return roots;
}

function consecutiveListGroups(items: readonly TextListTreeItem[]): TextListTreeItem[][] {
  const groups: TextListTreeItem[][] = [];
  for (const item of items) {
    const current = groups[groups.length - 1];
    if (!current || current[0]!.item.type !== item.item.type) groups.push([item]);
    else current.push(item);
  }
  return groups;
}

function renderTextList(
  list: CodegenTextList,
  textClasses: readonly string[],
  href: string | null,
  settings: Settings,
  depth: number
): string | null {
  const roots = textListTree(list);
  if (!roots) return null;
  const markerPosition = list.hanging === false ? 'list-inside' : 'list-outside';
  const markerGutter = list.hanging === false ? '' : 'pl-[1.25em]';

  const renderForest = (
    items: readonly TextListTreeItem[],
    forestDepth: number,
    forestClasses: readonly string[] = []
  ): string => {
    const groups = consecutiveListGroups(items);
    return groups
      .map((group, groupIndex) => {
        const type = group[0]!.item.type;
        const listTag = type === 'ORDERED' ? 'ol' : 'ul';
        const markerClass = type === 'ORDERED' ? 'list-decimal' : 'list-disc';
        const spacings = group.map((entry) => entry.item.itemSpacing);
        const uniformSpacing = spacings.every((value) => approximately(value, spacings[0] ?? 0));
        const listClasses = unique([
          markerClass,
          markerPosition,
          markerGutter,
          ...(group.length > 1 && uniformSpacing && (spacings[0] ?? 0) > 0
            ? [utility('space-y', spacings[0]!, settings)]
            : []),
          ...(groupIndex > 0 && group[0]!.item.itemSpacing > 0
            ? [utility('mt', group[0]!.item.itemSpacing, settings)]
            : []),
          ...(groupIndex === 0 ? forestClasses : [])
        ]);
        const indent = '  '.repeat(forestDepth);
        const itemIndent = '  '.repeat(forestDepth + 1);
        const renderedItems = group
          .map((entry, itemIndex) => {
            const itemClasses =
              !uniformSpacing && itemIndex > 0 && entry.item.itemSpacing > 0
                ? [utility('mt', entry.item.itemSpacing, settings)]
                : [];
            const itemContent = href
              ? `<a${stringAttribute('href', href)}>${escapeJsxText(entry.item.text)}</a>`
              : escapeJsxText(entry.item.text);
            if (!entry.children.length) return `${itemIndent}<li${classAttribute(itemClasses)}>${itemContent}</li>`;
            return `${itemIndent}<li${classAttribute(itemClasses)}>${itemContent}\n${renderForest(
              entry.children,
              forestDepth + 2
            )}\n${itemIndent}</li>`;
          })
          .join('\n');
        return `${indent}<${listTag}${classAttribute(listClasses)}>\n${renderedItems}\n${indent}</${listTag}>`;
      })
      .join('\n');
  };

  const rootGroups = consecutiveListGroups(roots);
  if (rootGroups.length === 1) return renderForest(roots, depth, textClasses);
  const indent = '  '.repeat(depth);
  return `${indent}<div${classAttribute(textClasses)}>\n${renderForest(roots, depth + 1)}\n${indent}</div>`;
}

function renderNode(
  node: ParsedNode,
  settings: Settings,
  depth: number,
  positionedByParent: boolean,
  context: RenderContext,
  forcedExtras: readonly string[] = [],
  forcedTextTag?: TextElementTag,
  binding?: RenderBinding,
  phrasingContext = false,
  inheritedTextClasses: readonly string[] = [],
  consumedHyperlink?: string,
  ancestorLandmarks: readonly SemanticContainerTag[] = []
): string {
  const indent = '  '.repeat(depth);
  const mode = layoutMode(node);
  const background = fullBleedBackground(node, settings);
  const semanticCandidate = phrasingContext ? null : semanticContainer(node);
  const semanticNode =
    semanticCandidate &&
    NON_NESTABLE_LANDMARKS.has(semanticCandidate.tag) &&
    ancestorLandmarks.includes(semanticCandidate.tag)
      ? null
      : semanticCandidate;
  if (semanticCandidate && !semanticNode)
    context.notes.add(
      `A camada “${node.name}” foi mantida como container neutro para evitar <${semanticCandidate.tag}> aninhado em outro <${semanticCandidate.tag}>.`
    );
  if (semanticNode) context.reasons.add(semanticNode.reason);
  if (semanticNode?.accessibilityReview) {
    requireAttention(context, 'semantic', semanticNode.accessibilityReview);
  }
  const semanticCardPlan = !phrasingContext && mode === 'absolute' ? simpleCardPlan(node, background) : null;
  const cardPlan =
    context.outputMode !== 'faithful' && mode === 'absolute' && semanticNode?.tag !== 'button'
      ? semanticCardPlan
      : null;
  let own = classList(node, settings).filter((value) => !inheritedTextClasses.includes(value));
  const extras: string[] = [...forcedExtras];

  if (positionedByParent) {
    const stretch = context.outputMode !== 'faithful' ? responsiveHorizontalStretch(node.codegen, settings, own) : null;
    if (stretch) own = own.filter((value) => !/^w-/.test(value));
    extras.push(...implicitPosition(node.codegen, settings, own), ...(stretch ?? []));
  }
  if (mode === 'absolute' && !own.includes('relative')) extras.push('relative');
  if (mode === 'flow' && node.structure?.source === 'auto-layout') extras.push(...node.structure.classes);
  if (mode === 'absolute' && node.structure?.source === 'heuristic' && node.structure.type !== 'unknown')
    context.notes.add(
      'A sugestão estrutural heurística não foi aplicada automaticamente; o JSX preserva as coordenadas do Figma.'
    );
  if (background) {
    extras.push(...background.classes);
    context.notes.add(
      'A camada de fundo que cobria todo o Group foi incorporada ao container para remover markup redundante.'
    );
  }

  let classes = classListWithBase(node, own, settings, extras).filter((value) => !inheritedTextClasses.includes(value));
  if (depth === 0)
    classes = classes.filter(
      (value) => !POSITION_CLASS.test(value) || (value === 'relative' && mode === 'absolute' && !cardPlan)
    );
  if (cardPlan) return renderSimpleCard(node, cardPlan, settings, depth, context, classes);
  const responsiveRoot =
    depth === 0 &&
    mode === 'flow' &&
    !!node.codegen &&
    (node.codegen.widthMode ?? 'fixed') === 'fixed' &&
    node.codegen.width >= 640 &&
    (context.outputMode === 'responsive' || context.outputMode === 'component');
  if (responsiveRoot) {
    const hadSize = classes.some((value) => value.startsWith('size-'));
    classes = classes.filter((value) => !/^(?:size|w|min-w|max-w)-/.test(value));
    const responsiveWidthClasses = ['w-full', utility('max-w', node.codegen!.width, settings)];
    if (hadSize && !classes.some((value) => HEIGHT_CLASS.test(value)))
      responsiveWidthClasses.push(utility('h', node.codegen!.height, settings));
    classes = classListWithBase(node, classes, settings, responsiveWidthClasses);
    context.notes.add('A largura fixa do container raiz foi convertida em largura fluida com limite máximo.');
  }
  const formField = phrasingContext ? null : semanticFormField(node);
  if (formField) {
    const fieldLayoutClass =
      /^(?:flex(?:-.+)?|inline-flex|grid(?:-.+)?|items-.+|justify-.+|content-.+|place-.+|gap(?:-.+)?|relative)$/;
    const fieldClasses = classes.filter((value) => !fieldLayoutClass.test(value));
    const textClasses = cleanTextClasses(formField.textNode, settings).filter(
      (value) => !fieldLayoutClass.test(value) && !/^whitespace-/.test(value)
    );
    classes = unique([...fieldClasses, ...textClasses]);
    const attributes = `${formField.inputType ? ` type="${formField.inputType}"` : ''}${stringAttribute(
      'placeholder',
      formField.placeholder
    )}${stringAttribute('aria-label', formField.ariaLabel)}`;
    context.reasons.add(
      `A camada “${node.name}” foi reconhecida como <${formField.tag}> por nome, estrutura e aparência de campo (${Math.round(formField.confidence * 100)}%).`
    );
    requireAttention(
      context,
      'semantic',
      `O placeholder e o aria-label de “${node.name}” foram inferidos do design; confirme o rótulo e conecte o campo ao estado do formulário.`
    );
    return formField.tag === 'input'
      ? `${indent}<input${attributes}${classAttribute(classes)} />`
      : `${indent}<textarea${attributes}${classAttribute(classes)}></textarea>`;
  }
  const imageUsage = resolvedImageUsage(node);
  if (node.codegen?.imageScaleMode && imageUsage === 'background') {
    classes = unique([...classes, `bg-[url('/images/${assetPath(node, context)}.png')]`]);
    if (node.codegen.imageScaleMode === 'FILL') classes = unique([...classes, 'bg-cover', 'bg-center']);
    else if (node.codegen.imageScaleMode === 'FIT')
      classes = unique([...classes, 'bg-contain', 'bg-center', 'bg-no-repeat']);
    else
      requireAttention(
        context,
        'review',
        `O background “${node.name}” usa ${node.codegen.imageScaleMode}; revise posição, escala e recorte após exportar o asset.`
      );
    requireAttention(context, 'setup', 'Substitua os caminhos em /images pelos assets exportados do Figma.');
  }
  if (node.type === 'TEXT') {
    const availableText = textContent(node);
    const text = availableText ?? '';
    const semanticTextTag = forcedTextTag ?? explicitTextTag(node.name);
    let tag: TextElementTag | 'a' = phrasingContext ? 'span' : (semanticTextTag ?? 'p');
    let tagAttributes = '';
    const hyperlink = node.codegen?.hyperlink;
    const href = hyperlink?.type === 'URL' ? safeHyperlinkHref(hyperlink.value) : null;
    const hyperlinkConsumedByAncestor = !!(href && consumedHyperlink === href);
    if (hyperlink && (!href || phrasingContext) && !hyperlinkConsumedByAncestor) {
      requireAttention(
        context,
        hyperlink.type === 'NODE' && !phrasingContext ? 'setup' : 'review',
        phrasingContext
          ? 'Um hyperlink dentro de um controle interativo foi ignorado para evitar elementos interativos aninhados.'
          : hyperlink.type === 'NODE'
            ? 'Um hyperlink para outro node do Figma não possui rota web conhecida e precisa ser configurado manualmente.'
            : 'Um hyperlink com URL vazia, malformada ou protocolo inseguro foi omitido do JSX.'
      );
    }
    if (href && !phrasingContext && !semanticTextTag && !hyperlinkConsumedByAncestor) {
      tag = 'a';
      tagAttributes = stringAttribute('href', href);
      context.reasons.add(`O hyperlink seguro da camada “${node.name}” foi preservado no JSX.`);
    }
    const textList = node.codegen?.textList;
    if (textList && !phrasingContext) {
      const renderedList = renderTextList(
        textList,
        classes,
        hyperlinkConsumedByAncestor ? null : href,
        settings,
        depth
      );
      if (renderedList) {
        const rootLevel = textList.items[0]?.indentationLevel ?? 1;
        const nested = textList.items.some((item) => item.indentationLevel > rootLevel);
        const mixedKinds = new Set(textList.items.map((item) => item.type)).size > 1;
        context.reasons.add(
          `A lista ${textList.type === 'ORDERED' ? 'ordenada' : 'não ordenada'} real do Figma foi preservada semanticamente${nested || mixedKinds ? ', incluindo sua hierarquia' : ''}.`
        );
        if (rootLevel > 1) {
          requireAttention(
            context,
            'review',
            `A lista começa no nível de recuo ${rootLevel}; confirme o contexto da lista ancestral no HTML.`
          );
        }
        return renderedList;
      }
      requireAttention(
        context,
        'review',
        'A hierarquia da lista estava inconsistente e foi mantida como texto para evitar HTML incorreto.'
      );
    }
    if (node.codegen?.textListIssue) {
      requireAttention(
        context,
        'review',
        node.codegen.textListIssue === 'mixed'
          ? 'O TextNode mistura lista ordenada, não ordenada ou parágrafos comuns; o texto foi mantido sem inventar uma estrutura HTML.'
          : 'A lista excedeu o limite seguro de itens/caracteres ou não pôde ser lida completamente; revise sua estrutura manualmente.'
      );
    }
    const preservesWhitespace = /[\n\t]| {2,}/.test(text) || text.startsWith(' ') || text.endsWith(' ');
    if (preservesWhitespace && !classes.includes('whitespace-pre-wrap'))
      classes = unique([...classes, 'whitespace-pre-wrap']);
    if (node.codegen?.textTruncated) {
      requireAttention(
        context,
        'review',
        'Um texto muito grande foi truncado no código montado pelo limite de segurança.'
      );
    }
    if (availableText === null && !binding?.textExpression) {
      requireAttention(
        context,
        'review',
        'O conteúdo de uma camada de texto não estava disponível; foi inserido um TODO em vez do nome da camada.'
      );
    }
    const mixed =
      binding?.textExpression || availableText === null
        ? null
        : mixedTextContent(node, text, classes, settings, context);
    let content = binding?.textExpression
      ? `{${binding.textExpression}}`
      : availableText === null
        ? '{/* TODO: inserir o texto do Figma */}'
        : (mixed ?? escapeJsxText(text));
    if (href && !phrasingContext && semanticTextTag && !hyperlinkConsumedByAncestor) {
      content = `<a${stringAttribute('href', href)}>${content}</a>`;
      context.reasons.add(`O hyperlink seguro da camada “${node.name}” foi preservado dentro de <${semanticTextTag}>.`);
    }
    return `${indent}<${tag}${tagAttributes}${classAttribute(classes)}>${content}</${tag}>`;
  }

  if (node.codegen?.imageScaleMode && node.children.length === 0 && imageUsage === 'image-element') {
    requireAttention(
      context,
      'semantic',
      `O ImagePaint de “${node.name}” foi interpretado como <img>; confirme se ele representa conteúdo ou apenas decoração.`
    );
    if (node.codegen.imageScaleMode === 'FILL') classes = unique([...classes, 'object-cover']);
    else if (node.codegen.imageScaleMode === 'FIT') classes = unique([...classes, 'object-contain']);
    else
      requireAttention(
        context,
        'review',
        `A imagem “${node.name}” usa ${node.codegen.imageScaleMode}; revise crop/tiling após exportar o asset.`
      );
    if (!binding?.imageSrcExpression) {
      requireAttention(context, 'setup', 'Substitua os caminhos em /images pelos assets exportados do Figma.');
    }
    const src = binding?.imageSrcExpression
      ? `src={${binding.imageSrcExpression}}`
      : `src="/images/${assetPath(node, context)}.png"`;
    const suggestedAlt = binding?.imageAltExpression ? null : inferredImageAlt(node);
    if (suggestedAlt) {
      requireAttention(
        context,
        'semantic',
        `O texto alternativo “${suggestedAlt}” foi sugerido pelo nome da camada; confirme se descreve a imagem no contexto.`
      );
    } else if (!binding?.imageAltExpression)
      requireAttention(
        context,
        'semantic',
        'A imagem recebeu alt vazio porque o nome da camada é genérico; confirme se ela é decorativa.'
      );
    const alt = binding?.imageAltExpression
      ? `alt={${binding.imageAltExpression}}`
      : stringAttribute('alt', suggestedAlt ?? '').trimStart();
    return `${indent}<img${classAttribute(classes)} ${src} ${alt} />`;
  }

  if (node.codegen?.imageScaleMode && node.children.length === 0 && imageUsage === 'unknown') {
    requireAttention(
      context,
      'review',
      `O ImagePaint de “${node.name}” não possui semântica HTML suficiente para escolher entre background e <img>.`
    );
    return `${indent}<div${classAttribute(classes)}>{/* TODO: decidir entre background e elemento de imagem */}</div>`;
  }

  if (node.codegen?.ambiguousImagePaint && node.children.length === 0) {
    requireAttention(context, 'review');
    return `${indent}<div${classAttribute(classes)}>{/* TODO: exportar os fills combinados como um único asset */}</div>`;
  }

  if (node.isVector && node.children.length === 0) {
    requireAttention(
      context,
      'review',
      'Elementos vetoriais foram deixados como placeholders e precisam ser exportados como SVG ou componente.'
    );
    const vectorTag = phrasingContext ? 'span' : 'div';
    return `${indent}<${vectorTag}${classAttribute(classes)} aria-hidden="true">{/* TODO: exportar este vetor como SVG */}</${vectorTag}>`;
  }

  const children = node.children.filter((child) => child.id !== background?.nodeId);
  const containerTag = phrasingContext ? 'span' : (semanticNode?.tag ?? 'div');
  let containerAttributes = semanticNode?.attributes ?? '';
  if (semanticNode?.tag === 'button' && ancestorLandmarks.includes('form') && isSubmitButton(node)) {
    containerAttributes = containerAttributes.replace('type="button"', 'type="submit"');
    context.reasons.add(
      `O botão “${node.name}” foi definido como submit por estar dentro de um formulário e indicar envio.`
    );
  }
  if (!children.length) {
    if (semanticNode)
      return `${indent}<${containerTag}${containerAttributes}${classAttribute(classes)}></${containerTag}>`;
    return `${indent}<${containerTag}${classAttribute(classes)} />`;
  }
  const ordered = mode === 'absolute' ? visualOrder(children) : children;
  const hoistedTextClasses =
    settings.outputProfile === 'optimized' &&
    mode === 'flow' &&
    children.length >= 2 &&
    children.every((child) => child.type === 'TEXT')
      ? commonTextClasses(children, settings)
      : [];
  if (hoistedTextClasses.length) {
    classes = unique([...classes, ...hoistedTextClasses]);
    context.notes.add(
      'Classes tipográficas compartilhadas pelos textos do Auto Layout foram herdadas pelo container para reduzir repetição.'
    );
  }
  if (mode === 'absolute')
    context.notes.add(
      'Layout livre preservado com posicionamento absoluto; considere Auto Layout no Figma para gerar fluxo responsivo.'
    );
  if (node.codegen?.reverseZIndex && mode === 'flow')
    context.notes.add('A ordem visual invertida do Auto Layout foi preservada com z-index explícito nos filhos.');
  const childPhrasingContext = phrasingContext || semanticNode?.tag === 'button' || semanticNode?.tag === 'a';
  const childConsumedHyperlink = semanticNode?.consumedHyperlink ?? consumedHyperlink;
  const childAncestorLandmarks =
    semanticNode && NON_NESTABLE_LANDMARKS.has(semanticNode.tag)
      ? [...ancestorLandmarks, semanticNode.tag]
      : ancestorLandmarks;
  const content = ordered
    .map((child, index) => {
      const zIndex = node.codegen?.reverseZIndex && mode === 'flow' ? [`z-[${ordered.length - index}]`] : [];
      const semanticTag = semanticCardPlan ? semanticCardTag(semanticCardPlan, child, settings, context) : undefined;
      return renderNode(
        child,
        settings,
        depth + 1,
        mode === 'absolute',
        context,
        zIndex,
        semanticTag,
        undefined,
        childPhrasingContext,
        child.type === 'TEXT' ? hoistedTextClasses : [],
        childConsumedHyperlink,
        childAncestorLandmarks
      );
    })
    .join('\n');
  const ambiguousImageNotice = node.codegen?.ambiguousImagePaint
    ? `${indent}  {/* TODO: exportar os fills combinados como background achatado */}\n`
    : '';
  return `${indent}<${containerTag}${containerAttributes}${classAttribute(classes)}>\n${ambiguousImageNotice}${content}\n${indent}</${containerTag}>`;
}

function walk(node: ParsedNode, visit: (current: ParsedNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

export function generateReactComponent(
  node: ParsedNode,
  settings: Settings,
  options: ComponentCodeOptions = {}
): ComponentCodeResult {
  const requestedMode = options.mode ?? 'responsive';
  const notes = new Set<string>();
  const reasons = new Set<string>();
  const assetCounts = new Map<string, number>();
  let unsupportedCount = 0;
  let unfaithfulConversions = 0;
  let partialNodes = 0;
  let parseErrors = 0;
  let contextPendingReview = false;
  let fontSetupPending = false;
  const smartAnalysis = analyzeSmartNodes([node], { debug: settings.smartDebug, maxNodes: 500 });
  for (const warning of smartAnalysis.warnings) notes.add(`[Análise] ${warning}`);
  for (const issue of smartAnalysis.lint.slice(0, 8)) notes.add(`[Design lint] ${issue.message}`);
  for (const issue of smartAnalysis.accessibility.filter((item) => item.severity !== 'info').slice(0, 8))
    notes.add(`[Acessibilidade] ${issue.message}${issue.autoFix ? ` ${issue.autoFix}` : ''}`);
  const strongTokens = smartAnalysis.tokens.filter((token) => token.confidence >= 0.75);
  if (strongTokens.length)
    notes.add(
      `${strongTokens.length} token(s) recorrente(s) detectado(s) como sugestão; nenhum nome de token foi aplicado sem configuração explícita.`
    );
  if (settings.smartDebug) {
    const visibleLogs = smartAnalysis.debugLog.slice(0, 30);
    if (visibleLogs.length) notes.add(`[Diagnóstico inteligente]\n${visibleLogs.join('\n\n')}`);
    if (smartAnalysis.debugLog.length > visibleLogs.length)
      notes.add(
        `[Diagnóstico inteligente] ${smartAnalysis.debugLog.length - visibleLogs.length} decisão(ões) omitidas do painel.`
      );
  }
  walk(node, (current) => {
    unsupportedCount += current.unsupported.length;
    unfaithfulConversions += current.conversions.filter((item) =>
      ['unsupported', 'approximation'].includes(item.fidelity ?? '')
    ).length;
    if (current.analysisLimited) partialNodes += 1;
    if (current.parseError) parseErrors += 1;
    if (current.type === 'TEXT' && classList(current, settings).some((value) => /^font-\[(?:'|")/.test(value)))
      fontSetupPending = true;
    if (Math.abs(current.codegen?.rotation ?? 0) > 0.01 || current.codegen?.complexTransform) {
      contextPendingReview = true;
      notes.add(
        'Há transformações geométricas que não foram aplicadas automaticamente; revise rotação, escala, skew ou reflexão.'
      );
    }
    if (current.codegen?.imageScaleMode) {
      const name = assetName(current.name);
      assetCounts.set(name, (assetCounts.get(name) ?? 0) + 1);
    }
    if (current.codegen?.ambiguousImagePaint) {
      contextPendingReview = true;
      notes.add(
        'Uma composição com múltiplos fills de imagem precisa ser exportada como asset achatado ou recriada manualmente.'
      );
    }
  });
  const background = fullBleedBackground(node, settings);
  const rootSemanticNode = semanticContainer(node);
  const rootCardPlan = rootSemanticNode?.tag === 'button' ? null : simpleCardPlan(node, background);
  const effectiveMode: ComponentOutputMode =
    requestedMode === 'component' && !supportsCardProps(rootCardPlan, settings) ? 'responsive' : requestedMode;
  const context: RenderContext = {
    notes,
    reasons,
    attention:
      unsupportedCount > 0 || unfaithfulConversions > 0 || partialNodes > 0 || parseErrors > 0 || contextPendingReview
        ? 'review'
        : fontSetupPending
          ? 'setup'
          : 'ready',
    assetCounts,
    ...(options.assetPrefix ? { assetPrefix: assetName(options.assetPrefix) } : {}),
    outputMode: effectiveMode,
    componentHrefProp: effectiveMode === 'component' && rootSemanticNode?.tag === 'a'
  };
  if (requestedMode === 'component' && effectiveMode !== 'component') {
    requireAttention(
      context,
      'review',
      'Componente com props indisponível para esta estrutura; foi gerado o JSX responsivo ou o fallback fiel mais seguro.'
    );
  }
  if (unsupportedCount)
    notes.add(`${unsupportedCount} propriedade(s) não foram convertidas com fidelidade; revise os avisos do elemento.`);
  if (unfaithfulConversions)
    notes.add(`${unfaithfulConversions} conversão(ões) são aproximações ou não suportadas e exigem revisão.`);
  if (partialNodes)
    notes.add('A análise foi parcial; confirme se todas as camadas necessárias aparecem antes de usar o componente.');
  if (parseErrors) notes.add(`${parseErrors} camada(s) falharam durante a análise e não possuem código completo.`);
  if (fontSetupPending)
    notes.add('Carregue ou mapeie as famílias tipográficas arbitrárias antes de usar o componente no projeto.');
  const layout = effectiveMode !== 'faithful' && rootCardPlan ? 'flow' : layoutMode(node);
  if (effectiveMode === 'component')
    reasons.add('Card reutilizável reconhecido com imagem, título semântico e descrição completos.');
  else if (effectiveMode !== 'faithful' && rootCardPlan)
    reasons.add('Fluxo responsivo comprovado por imagem full-width, coluna de textos, padding e gaps consistentes.');
  else if (node.codegen?.layoutMode !== 'NONE')
    reasons.add(`Estrutura baseada no ${node.codegen?.layoutMode === 'GRID' ? 'Grid' : 'Auto Layout'} real do Figma.`);
  else reasons.add('Layout livre preservado por coordenadas locais para evitar uma inferência estrutural insegura.');
  const jsx = renderNode(node, settings, 0, false, context);
  const code = effectiveMode === 'component' ? componentWithProps(node, jsx, context.componentHrefProp) : jsx;
  const riskPenalty =
    Math.min(0.3, unsupportedCount * 0.03) +
    Math.min(0.15, unfaithfulConversions * 0.025) +
    Math.min(0.2, partialNodes * 0.1) +
    Math.min(0.3, parseErrors * 0.15) +
    (contextPendingReview ? 0.2 : 0);
  const baseConfidence =
    effectiveMode === 'component'
      ? 0.94
      : effectiveMode !== 'faithful' && rootCardPlan
        ? 0.97
        : node.codegen?.layoutMode !== 'NONE'
          ? 0.99
          : 0.95;
  const reviewPenalty = componentNeedsReview(context.attention) && riskPenalty === 0 ? 0.06 : 0;
  const confidence = Number(Math.max(0.05, baseConfidence - riskPenalty - reviewPenalty).toFixed(2));
  if (riskPenalty > 0)
    reasons.add('A confiança foi reduzida porque a árvore contém dados parciais ou não representáveis.');
  return {
    code,
    layout,
    notes: [...notes],
    reasons: [...reasons],
    confidence,
    reviewRequired: componentNeedsReview(context.attention),
    attention: context.attention,
    mode: effectiveMode
  };
}

type SelectionArrangementKind = 'horizontal' | 'vertical' | 'wrapped' | 'absolute' | 'unknown';
const MAX_SELECTION_CODE_CHARACTERS = 300_000;

interface SelectionArrangement {
  kind: SelectionArrangementKind;
  ordered: ParsedNode[];
  gap: number;
  rowGap?: number;
  mainAxis: 'start' | 'center' | 'end';
  crossAxis: 'start' | 'center' | 'end';
  bounds?: { x: number; y: number; width: number; height: number };
  confidence: number;
  reason: string;
}

function repeatedSelectionCode(
  nodes: readonly ParsedNode[],
  settings: Settings,
  wrapperClasses: readonly string[],
  smart: SmartAnalysisResult
): { code: string; component: ComponentCodeResult; note: string; reason: string } | null {
  if (nodes.length < 3 || !wrapperClasses.length) return null;
  const repetition = smart.repetitions.find(
    (item) =>
      item.useDataMap && item.nodeIds.length === nodes.length && nodes.every((node) => item.nodeIds.includes(node.id))
  );
  if (!repetition || repetition.confidence < 0.75) return null;
  const plans = nodes.map((node) => simpleCardPlan(node, fullBleedBackground(node, settings)));
  if (plans.some((plan) => !supportsCardProps(plan, settings))) return null;
  const safePlans = plans.filter((plan): plan is SimpleCardPlan => !!plan);
  if (safePlans.length !== nodes.length) return null;
  const firstSemantic = semanticContainer(nodes[0]!);
  const includeHref = firstSemantic?.tag === 'a';
  const hrefs = nodes.map((node) => sharedSafeDescendantHyperlink(node));
  if (includeHref && hrefs.some((href) => !href)) return null;
  const component = generateReactComponent(nodes[0]!, settings, { mode: 'component' });
  if (component.mode !== 'component') return null;
  const data = safePlans.map((plan, index) => {
    const title = textContent(plan.content[0]!) ?? '';
    const description = textContent(plan.content[1]!) ?? '';
    return {
      id: nodes[index]!.id,
      title,
      description,
      imageSrc: `/images/card-${index + 1}.png`,
      imageAlt: inferredImageAlt(plan.media) ?? '',
      ...(includeHref ? { href: hrefs[index]! } : {})
    };
  });
  const name = componentName(nodes[0]!);
  const dataName = `${name[0]!.toLowerCase()}${name.slice(1)}Items`;
  const collectionName = `${name}Collection`;
  const serialized = JSON.stringify(data, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  const usage = `<div${classAttribute(wrapperClasses)}>
      {${dataName}.map((item) => (
        <${name} key={item.id} {...item} />
      ))}
    </div>`;
  const code = `${component.code}

const ${dataName} =
${serialized} as const;

export function ${collectionName}() {
  return (
    ${usage}
  );
}`;
  return {
    code,
    component,
    note: `${nodes.length} itens repetidos foram convertidos em dados + map; revise nomes de props e caminhos dos assets.`,
    reason: `Assinatura estrutural repetida detectada com ${Math.round(repetition.confidence * 100)}% de confiança.`
  };
}

function horizontalMainAxisAlignment(
  nodes: readonly ParsedNode[],
  tolerance: number
): SelectionArrangement['mainAxis'] {
  const parentWidths = nodes.map((node) => node.codegen?.parentWidth);
  if (parentWidths.some((value) => value === undefined || !Number.isFinite(value))) return 'start';
  if (!aligned(parentWidths as number[], tolerance)) return 'start';
  const parentWidth = parentWidths[0]!;
  const left = Math.min(...nodes.map((node) => node.codegen!.x));
  const right = parentWidth - Math.max(...nodes.map((node) => node.codegen!.x + node.codegen!.width));
  if (left < -tolerance || right < -tolerance) return 'start';
  if (approximately(left, right, tolerance) && left > tolerance) return 'center';
  if (right <= tolerance && left > tolerance) return 'end';
  return 'start';
}

function consistentGap(values: readonly number[], tolerance: number): boolean {
  if (!values.length) return true;
  return Math.min(...values) >= -0.01 && Math.max(...values) - Math.min(...values) <= tolerance;
}

function aligned(values: readonly number[], tolerance: number): boolean {
  return values.length > 0 && Math.max(...values) - Math.min(...values) <= tolerance;
}

function crossAxisAlignment(
  starts: readonly number[],
  sizes: readonly number[],
  tolerance: number
): SelectionArrangement['crossAxis'] | null {
  if (aligned(starts, tolerance)) return 'start';
  if (
    aligned(
      starts.map((value, index) => value + (sizes[index] ?? 0) / 2),
      tolerance
    )
  )
    return 'center';
  if (
    aligned(
      starts.map((value, index) => value + (sizes[index] ?? 0)),
      tolerance
    )
  )
    return 'end';
  return null;
}

function wrappedArrangement(
  nodes: readonly ParsedNode[],
  alignmentTolerance: number,
  gapTolerance: number
): SelectionArrangement | null {
  const byY = [...nodes].sort(
    (left, right) => left.codegen!.y - right.codegen!.y || left.codegen!.x - right.codegen!.x
  );
  const rows: ParsedNode[][] = [];
  for (const node of byY) {
    const current = rows[rows.length - 1];
    if (!current || Math.abs(node.codegen!.y - current[0]!.codegen!.y) > alignmentTolerance) rows.push([node]);
    else current.push(node);
  }
  if (rows.length < 2) return null;
  const columnCount = rows[0]?.length ?? 0;
  if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) return null;
  for (const row of rows) row.sort((left, right) => left.codegen!.x - right.codegen!.x);

  const horizontalGaps = rows.flatMap((row) =>
    row.slice(1).map((node, index) => {
      const previous = row[index]!.codegen!;
      return node.codegen!.x - (previous.x + previous.width);
    })
  );
  if (!consistentGap(horizontalGaps, gapTolerance)) return null;

  const firstRow = rows[0]!;
  for (const row of rows.slice(1))
    for (let column = 0; column < columnCount; column += 1) {
      const reference = firstRow[column]!.codegen!;
      const candidate = row[column]!.codegen!;
      if (
        !approximately(reference.x, candidate.x, alignmentTolerance) ||
        !approximately(reference.width, candidate.width, alignmentTolerance)
      )
        return null;
    }

  const verticalGaps = rows.slice(1).map((row, index) => {
    const previous = rows[index]!;
    const previousBottom = Math.max(...previous.map((node) => node.codegen!.y + node.codegen!.height));
    return row[0]!.codegen!.y - previousBottom;
  });
  if (!consistentGap(verticalGaps, gapTolerance)) return null;

  const metadata = nodes.map((node) => node.codegen!);
  const minX = Math.min(...metadata.map((item) => item.x));
  const minY = Math.min(...metadata.map((item) => item.y));
  const maxX = Math.max(...metadata.map((item) => item.x + item.width));
  const maxY = Math.max(...metadata.map((item) => item.y + item.height));
  return {
    kind: 'wrapped',
    ordered: rows.flat(),
    gap: horizontalGaps.reduce((sum, value) => sum + value, 0) / horizontalGaps.length,
    rowGap: verticalGaps.reduce((sum, value) => sum + value, 0) / verticalGaps.length,
    mainAxis: 'start',
    crossAxis: 'start',
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    confidence: 0.98,
    reason: `${nodes.length} elementos formam ${rows.length} linhas regulares de ${columnCount} itens; o conjunto foi convertido para flex-wrap responsivo.`
  };
}

function selectionArrangement(nodes: readonly ParsedNode[], settings: Settings): SelectionArrangement {
  const metadata = nodes.map((node) => node.codegen);
  const parentIds = new Set(metadata.map((item) => item?.parentId).filter((id): id is string => !!id));
  const comparable =
    metadata.every(
      (item) =>
        !!item &&
        !!item.parentId &&
        [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
        item.width >= 0 &&
        item.height >= 0
    ) && parentIds.size === 1;
  if (!comparable)
    return {
      kind: 'unknown',
      ordered: [...nodes],
      gap: 0,
      mainAxis: 'start',
      crossAxis: 'start',
      confidence: 0.55,
      reason: 'Os elementos não compartilham um sistema de coordenadas comprovado; foram mantidos separadamente.'
    };

  if (
    nodes.some(
      (node) =>
        node.codegen?.complexTransform || Math.abs(node.codegen?.rotation ?? 0) > 0.01 || node.parseError !== undefined
    )
  )
    return {
      kind: 'unknown',
      ordered: [...nodes],
      gap: 0,
      mainAxis: 'start',
      crossAxis: 'start',
      confidence: 0.35,
      reason:
        'A seleção contém transformação geométrica ou falha de análise; nenhum fluxo estrutural foi inferido automaticamente.'
    };

  // JSX copiável exige evidência geométrica mais forte do que as sugestões do painel.
  const alignmentTolerance = Math.min(0.75, settings.alignmentTolerancePx);
  const gapTolerance = Math.min(0.75, settings.gapTolerancePx);

  const horizontal = [...nodes].sort((left, right) => left.codegen!.x - right.codegen!.x);
  const horizontalGaps = horizontal.slice(1).map((node, index) => {
    const previous = horizontal[index]!.codegen!;
    return node.codegen!.x - (previous.x + previous.width);
  });
  const horizontalCrossAxis = crossAxisAlignment(
    horizontal.map((node) => node.codegen!.y),
    horizontal.map((node) => node.codegen!.height),
    alignmentTolerance
  );
  if (horizontalCrossAxis && consistentGap(horizontalGaps, gapTolerance))
    return {
      kind: 'horizontal',
      ordered: horizontal,
      gap: Math.max(0, horizontalGaps.reduce((sum, value) => sum + value, 0) / Math.max(1, horizontalGaps.length)),
      mainAxis: horizontalMainAxisAlignment(horizontal, alignmentTolerance),
      crossAxis: horizontalCrossAxis,
      confidence: 0.97,
      reason: `${nodes.length} elementos alinhados horizontalmente pelo ${horizontalCrossAxis === 'start' ? 'início' : horizontalCrossAxis === 'center' ? 'centro' : 'fim'} e com gaps consistentes foram montados em fluxo horizontal.`
    };

  const vertical = [...nodes].sort((top, bottom) => top.codegen!.y - bottom.codegen!.y);
  const verticalGaps = vertical.slice(1).map((node, index) => {
    const previous = vertical[index]!.codegen!;
    return node.codegen!.y - (previous.y + previous.height);
  });
  const verticalCrossAxis = crossAxisAlignment(
    vertical.map((node) => node.codegen!.x),
    vertical.map((node) => node.codegen!.width),
    alignmentTolerance
  );
  if (verticalCrossAxis && consistentGap(verticalGaps, gapTolerance))
    return {
      kind: 'vertical',
      ordered: vertical,
      gap: Math.max(0, verticalGaps.reduce((sum, value) => sum + value, 0) / Math.max(1, verticalGaps.length)),
      mainAxis: 'start',
      crossAxis: verticalCrossAxis,
      confidence: 0.97,
      reason: `${nodes.length} elementos alinhados verticalmente pelo ${verticalCrossAxis === 'start' ? 'início' : verticalCrossAxis === 'center' ? 'centro' : 'fim'} e com gaps consistentes foram montados em flex-col.`
    };

  const wrapped = wrappedArrangement(nodes, alignmentTolerance, gapTolerance);
  if (wrapped) return wrapped;

  const minX = Math.min(...metadata.map((item) => item!.x));
  const minY = Math.min(...metadata.map((item) => item!.y));
  const maxX = Math.max(...metadata.map((item) => item!.x + item!.width));
  const maxY = Math.max(...metadata.map((item) => item!.y + item!.height));
  return {
    kind: 'absolute',
    ordered: [...nodes],
    gap: 0,
    mainAxis: 'start',
    crossAxis: 'start',
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    confidence: 0.95,
    reason: 'A disposição é irregular; um container relativo preserva as posições locais sem inventar Flexbox ou Grid.'
  };
}

export function generateReactSelection(
  nodes: readonly ParsedNode[],
  settings: Settings,
  options: ComponentCodeOptions = {}
): ComponentCodeResult | null {
  if (!nodes.length) return null;
  if (nodes.length === 1) return generateReactComponent(nodes[0]!, settings, options);

  const requestedMode = options.mode ?? 'responsive';
  const responsiveAttempt =
    requestedMode === 'faithful' ? null : responsiveVariantAttempt(nodes, settings, options.responsiveOverrides);
  if (responsiveAttempt?.kind === 'matched') {
    const { plan } = responsiveAttempt;
    const generated = generateReactComponent(plan.node, settings, {
      mode: 'responsive',
      assetPrefix: 'responsive'
    });
    const unresolvedResponsiveReview = plan.comparison.suggestions.some(
      (suggestion) => !suggestion.applied && suggestion.fidelity === 'review'
    );
    const attention = mergeComponentAttention(
      generated.attention,
      unresolvedResponsiveReview ? 'review' : 'ready',
      requestedMode === 'component' ? 'review' : 'ready'
    );
    return {
      ...generated,
      notes: unique([
        ...plan.notes,
        ...(requestedMode === 'component'
          ? ['As variantes responsivas foram priorizadas; o modo com props voltou para JSX responsivo.']
          : []),
        ...generated.notes
      ]),
      reasons: unique([plan.reason, ...generated.reasons]),
      confidence: Math.min(plan.confidence, generated.confidence),
      reviewRequired: componentNeedsReview(attention),
      attention,
      mode: 'responsive',
      responsiveStrategy: 'media-query'
    };
  }

  const arrangement = selectionArrangement(nodes, settings);
  const selectionSmart =
    requestedMode === 'component'
      ? analyzeSmartNodes(nodes, { debug: settings.smartDebug, maxNodes: Math.min(750, nodes.length * 80) })
      : null;
  const effectiveMode: ComponentOutputMode =
    arrangement.kind === 'absolute' || arrangement.kind === 'unknown'
      ? 'faithful'
      : requestedMode === 'component'
        ? 'responsive'
        : requestedMode;
  const children: ComponentCodeResult[] = [];
  let accumulatedCodeCharacters = 0;
  for (const [index, node] of arrangement.ordered.entries()) {
    const cardPlan = simpleCardPlan(node, fullBleedBackground(node, settings));
    const child = generateReactComponent(node, settings, {
      mode: effectiveMode,
      assetPrefix: cardPlan ? `card-${index + 1}` : `selection-${index + 1}`
    });
    if (children.length > 0 && accumulatedCodeCharacters + child.code.length > MAX_SELECTION_CODE_CHARACTERS) break;
    children.push(child);
    accumulatedCodeCharacters += child.code.length;
  }
  const renderedNodes = arrangement.ordered.slice(0, children.length);
  const omittedCount = arrangement.ordered.length - renderedNodes.length;
  const notes = new Set(children.flatMap((result) => result.notes));
  for (const variant of selectionSmart?.variants ?? [])
    notes.add(
      `${variant.componentName}: variantes ${variant.variantNames.join(', ')} detectadas (${Math.round(variant.confidence * 100)}%); diferenças mantidas explícitas até existir uma prop segura para todos os estilos.`
    );
  for (const warning of selectionSmart?.warnings ?? []) notes.add(`[Análise da seleção] ${warning}`);
  if (responsiveAttempt?.kind === 'rejected') notes.add(responsiveAttempt.note);
  const reasons = new Set<string>([arrangement.reason, ...children.flatMap((result) => result.reasons)]);
  for (const variant of selectionSmart?.variants ?? [])
    reasons.add(
      `Estrutura reutilizável com ${variant.differences.length} domínio(s) visual(is) variável(is) detectada.`
    );
  let attention = mergeComponentAttention(...children.map((result) => result.attention));
  if (omittedCount > 0) {
    attention = mergeComponentAttention(attention, 'review');
    notes.add(
      `${omittedCount} elemento(s) não entraram no JSX porque o limite seguro de ${Math.round(MAX_SELECTION_CODE_CHARACTERS / 1_000)} mil caracteres foi atingido.`
    );
  }
  let code: string;
  let selectionWrapperClasses: string[] = [];
  if (arrangement.kind === 'horizontal' || arrangement.kind === 'vertical' || arrangement.kind === 'wrapped') {
    const crossAxisClass =
      arrangement.crossAxis === 'center'
        ? 'items-center'
        : arrangement.crossAxis === 'end'
          ? 'items-end'
          : 'items-start';
    const wrapperClasses = unique([
      'flex',
      ...(arrangement.kind === 'horizontal'
        ? [
            effectiveMode === 'faithful' ? 'flex-nowrap' : 'flex-wrap',
            ...(arrangement.mainAxis === 'center'
              ? ['justify-center']
              : arrangement.mainAxis === 'end'
                ? ['justify-end']
                : []),
            crossAxisClass,
            '[&>*]:shrink-0'
          ]
        : arrangement.kind === 'vertical'
          ? ['flex-col', crossAxisClass]
          : [
              'flex-wrap',
              'items-start',
              '[&>*]:shrink-0',
              effectiveMode === 'faithful' ? utility('w', arrangement.bounds!.width, settings) : 'w-full',
              ...(effectiveMode === 'faithful' ? [] : [utility('max-w', arrangement.bounds!.width, settings)])
            ]),
      ...(arrangement.kind === 'wrapped'
        ? approximately(arrangement.gap, arrangement.rowGap ?? 0, 0.001)
          ? arrangement.gap > 0
            ? [utility('gap', arrangement.gap, settings)]
            : []
          : [
              ...(arrangement.gap > 0 ? [utility('gap-x', arrangement.gap, settings)] : []),
              ...((arrangement.rowGap ?? 0) > 0 ? [utility('gap-y', arrangement.rowGap!, settings)] : [])
            ]
        : arrangement.gap > 0
          ? [utility('gap', arrangement.gap, settings)]
          : [])
    ]);
    selectionWrapperClasses = wrapperClasses;
    const omission =
      omittedCount > 0 ? `\n  {/* ${omittedCount} elemento(s) omitido(s) pelo limite de segurança. */}` : '';
    code = `<div${classAttribute(wrapperClasses)}>\n${children.map((result) => indentCode(result.code, 2)).join('\n')}${omission}\n</div>`;
  } else if (arrangement.kind === 'absolute' && arrangement.bounds) {
    const wrapperClasses = [
      'relative',
      utility('w', arrangement.bounds.width, settings),
      utility('h', arrangement.bounds.height, settings)
    ];
    const childCode = renderedNodes
      .map((node, index) => {
        const positionClasses = [
          'absolute',
          signedUtility('left', node.codegen!.x - arrangement.bounds!.x, settings),
          signedUtility('top', node.codegen!.y - arrangement.bounds!.y, settings)
        ];
        return `  <div${classAttribute(positionClasses)}>\n${indentCode(children[index]!.code, 4)}\n  </div>`;
      })
      .join('\n');
    const omission =
      omittedCount > 0 ? `\n  {/* ${omittedCount} elemento(s) omitido(s) pelo limite de segurança. */}` : '';
    code = `<div${classAttribute(wrapperClasses)}>\n${childCode}${omission}\n</div>`;
  } else {
    attention = mergeComponentAttention(attention, 'review');
    notes.add(
      'Revise a disposição dos elementos: não foi possível comparar suas coordenadas entre os diferentes pais.'
    );
    const omission =
      omittedCount > 0 ? `\n  {/* ${omittedCount} elemento(s) omitido(s) pelo limite de segurança. */}` : '';
    code = `<>\n${children.map((result) => indentCode(result.code, 2)).join('\n')}${omission}\n</>`;
  }

  if (requestedMode === 'component' && omittedCount === 0) {
    const repeated = selectionSmart
      ? repeatedSelectionCode(renderedNodes, settings, selectionWrapperClasses, selectionSmart)
      : null;
    if (repeated) {
      const repeatedAttention = mergeComponentAttention(attention, repeated.component.attention);
      return {
        code: repeated.code,
        layout: 'flow',
        notes: unique([...notes, repeated.note, ...repeated.component.notes]),
        reasons: unique([...reasons, repeated.reason, ...repeated.component.reasons]),
        confidence: Number(Math.min(arrangement.confidence, repeated.component.confidence).toFixed(2)),
        reviewRequired: componentNeedsReview(repeatedAttention),
        attention: repeatedAttention,
        mode: 'component',
        responsiveStrategy: 'fluid'
      };
    }
  }

  if (requestedMode === 'component') {
    attention = mergeComponentAttention(attention, 'review');
    notes.add(
      'Componente com props para múltiplas seleções não pôde ser combinado com segurança; foi gerado JSX responsivo por elemento.'
    );
  }

  const childConfidence = Math.min(...children.map((result) => result.confidence));
  const confidence = Number(
    Math.max(0.05, Math.min(arrangement.confidence, childConfidence) - (omittedCount > 0 ? 0.25 : 0)).toFixed(2)
  );
  return {
    code,
    layout: arrangement.kind === 'absolute' ? 'absolute' : 'flow',
    notes: [...notes],
    reasons: [...reasons],
    confidence,
    reviewRequired: componentNeedsReview(attention),
    attention,
    mode: effectiveMode,
    ...(effectiveMode === 'responsive' ? { responsiveStrategy: 'fluid' as const } : {})
  };
}
