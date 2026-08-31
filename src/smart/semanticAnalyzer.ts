import type {
  DecisionEvidence,
  ParsedNode,
  SemanticDecision,
  SemanticType,
  SmartAppearance,
  SmartLayout,
  SmartNode
} from '../types';
import { resolvedImageUsage } from '../codegen/assetResolver';
import { confidenceLevel, scoreEvidence } from './confidenceEngine';
import { getStructuralSignature } from './structuralSignature';

interface NodeFeatures {
  name: string;
  words: Set<string>;
  componentLike: boolean;
  autoLayout: boolean;
  horizontal: boolean;
  vertical: boolean;
  grid: boolean;
  childCount: number;
  textChildren: number;
  textDescendants: number;
  imageChildren: number;
  iconChildren: number;
  inputChildren: number;
  hasBackground: boolean;
  hasRadius: boolean;
  hasPadding: boolean;
  hasGap: boolean;
  hasHyperlink: boolean;
  width: number;
  height: number;
}

const GENERIC_NAMES = /^(?:frame|group|rectangle|component|instance|section|layer)(?:\s|[-_]?[0-9]|$)/i;

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(features: NodeFeatures, ...values: string[]): boolean {
  return values.some((value) => features.words.has(value));
}

function descendants(node: ParsedNode, predicate: (child: ParsedNode) => boolean, limit = 80): number {
  let count = 0;
  let visited = 0;
  const stack = [...node.children];
  while (stack.length && visited < limit) {
    const child = stack.pop()!;
    visited += 1;
    if (predicate(child)) count += 1;
    stack.push(...child.children);
  }
  return count;
}

function isIcon(node: ParsedNode): boolean {
  return node.isVector || ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE'].includes(node.type);
}

function features(node: ParsedNode): NodeFeatures {
  const name = normalizeName(node.name);
  const layout = node.codegen?.layoutMode;
  return {
    name,
    words: new Set(name.split(' ').filter(Boolean)),
    componentLike: node.type === 'COMPONENT' || node.type === 'INSTANCE',
    autoLayout: layout === 'HORIZONTAL' || layout === 'VERTICAL',
    horizontal: layout === 'HORIZONTAL',
    vertical: layout === 'VERTICAL',
    grid: layout === 'GRID' || node.structure?.type === 'grid',
    childCount: node.children.length,
    textChildren: node.children.filter((child) => child.type === 'TEXT').length,
    textDescendants: descendants(node, (child) => child.type === 'TEXT'),
    imageChildren: descendants(
      node,
      (child) => child.codegen?.imageScaleMode !== undefined && resolvedImageUsage(child) === 'image-element'
    ),
    iconChildren: descendants(node, isIcon),
    inputChildren: descendants(node, (child) => /(?:input|field|campo)/i.test(child.name)),
    hasBackground: node.conversions.some((item) => item.category === 'background' && item.classes.length > 0),
    hasRadius: node.conversions.some((item) => item.category === 'border' && item.property.includes('radius')),
    hasPadding: node.conversions.some((item) => item.category === 'spacing' && item.property.startsWith('padding')),
    hasGap: node.conversions.some((item) => item.category === 'spacing' && item.property.startsWith('gap')),
    hasHyperlink: descendants(node, (child) => child.codegen?.hyperlink?.type === 'URL') > 0,
    width: node.codegen?.width ?? 0,
    height: node.codegen?.height ?? 0
  };
}

function evidence(id: string, label: string, weight: number, matched: boolean, detail?: string): DecisionEvidence {
  return { id, label, weight, matched, ...(detail ? { detail } : {}) };
}

function candidate(type: SemanticType, items: DecisionEvidence[]): SemanticDecision {
  const confidence = scoreEvidence(items);
  return { type, confidence, level: confidenceLevel(confidence), evidence: items };
}

function buttonCandidate(f: NodeFeatures): SemanticDecision {
  const compact = f.width >= 24 && f.width <= 480 && f.height >= 24 && f.height <= 104;
  const content = f.textDescendants > 0 || f.iconChildren > 0;
  return candidate('button', [
    evidence('interactive-component', 'Component ou Instance', 20, f.componentLike),
    evidence('auto-layout', 'Auto Layout', 15, f.autoLayout),
    evidence('button-content', 'Texto ou ícone acessível', 15, content),
    evidence('button-size', 'Dimensões compatíveis com controle', 10, compact),
    evidence('horizontal-padding', 'Padding definido', 10, f.hasPadding),
    evidence('button-background', 'Background visível', 10, f.hasBackground),
    evidence('button-radius', 'Border radius', 10, f.hasRadius),
    evidence('button-name', 'Nome sugere botão', 10, hasWord(f, 'button', 'btn', 'botao', 'cta'))
  ]);
}

function cardCandidate(f: NodeFeatures): SemanticDecision {
  const contentMix = f.textDescendants > 0 && (f.imageChildren > 0 || f.childCount >= 2);
  const cardSize = f.width >= 120 && f.height >= 80;
  return candidate('card', [
    evidence('card-component', 'Component ou Instance', 12, f.componentLike),
    evidence('card-layout', 'Container com layout', 14, f.autoLayout || f.grid),
    evidence('card-content', 'Combinação de conteúdo', 22, contentMix),
    evidence('card-size', 'Dimensões de card', 10, cardSize),
    evidence('card-background', 'Superfície própria', 14, f.hasBackground),
    evidence('card-radius', 'Cantos arredondados', 12, f.hasRadius),
    evidence('card-spacing', 'Padding ou gap', 8, f.hasPadding || f.hasGap),
    evidence('card-name', 'Nome sugere card', 8, hasWord(f, 'card', 'tile', 'product'))
  ]);
}

function landmarkCandidate(type: SemanticType, f: NodeFeatures, names: readonly string[]): SemanticDecision {
  const nameMatch = names.some((name) => f.name === name || f.words.has(name));
  const geometryMatch =
    type === 'sidebar'
      ? f.height > f.width * 1.4
      : type === 'navbar' || type === 'header' || type === 'footer'
        ? f.width > f.height * 3
        : true;
  return candidate(type, [
    evidence(`${type}-name`, `Nome semântico de ${type}`, 55, nameMatch),
    evidence(`${type}-children`, 'Possui conteúdo filho', 15, f.childCount > 0),
    evidence(`${type}-layout`, 'Layout de container', 15, f.autoLayout || f.grid),
    evidence(`${type}-geometry`, 'Geometria compatível', 15, geometryMatch)
  ]);
}

function formCandidate(f: NodeFeatures): SemanticDecision {
  return candidate('form', [
    evidence('form-name', 'Nome sugere formulário', 30, hasWord(f, 'form', 'formulario', 'login', 'signup')),
    evidence('form-inputs', 'Contém campos de entrada', 30, f.inputChildren >= 1),
    evidence('form-text', 'Contém labels ou textos', 15, f.textDescendants >= 1),
    evidence('form-layout', 'Organização vertical', 15, f.vertical),
    evidence('form-spacing', 'Padding ou gap consistente', 10, f.hasPadding || f.hasGap)
  ]);
}

function inputCandidate(f: NodeFeatures): SemanticDecision {
  const elongated = f.width >= 100 && f.height >= 28 && f.height <= 96;
  return candidate('input', [
    evidence('input-name', 'Nome sugere campo', 35, hasWord(f, 'input', 'field', 'campo', 'textarea')),
    evidence('input-component', 'Component ou Instance', 15, f.componentLike),
    evidence('input-shape', 'Formato de campo', 15, elongated),
    evidence('input-content', 'Texto interno', 15, f.textDescendants > 0),
    evidence('input-surface', 'Background ou borda', 12, f.hasBackground || f.hasRadius),
    evidence('input-layout', 'Layout interno', 8, f.autoLayout)
  ]);
}

function listCandidate(node: ParsedNode, f: NodeFeatures): SemanticDecision {
  const signatures = node.children.map(getStructuralSignature);
  const mostFrequent = Math.max(
    0,
    ...[...new Set(signatures)].map((value) => signatures.filter((item) => item === value).length)
  );
  return candidate('list', [
    evidence('list-name', 'Nome sugere lista', 20, hasWord(f, 'list', 'lista', 'menu')),
    evidence('list-count', 'Três ou mais itens', 20, f.childCount >= 3),
    evidence('list-repeat', 'Filhos estruturalmente repetidos', 35, mostFrequent >= 3),
    evidence('list-layout', 'Layout sequencial', 15, f.autoLayout || f.grid),
    evidence('list-gap', 'Espaçamento entre itens', 10, f.hasGap)
  ]);
}

function fallbackCandidate(type: SemanticType, f: NodeFeatures, node: ParsedNode): SemanticDecision {
  if (type === 'image')
    return candidate(type, [
      evidence(
        'image-paint',
        'Possui ImagePaint com semântica de imagem',
        80,
        node.codegen?.imageScaleMode !== undefined && resolvedImageUsage(node) === 'image-element'
      ),
      evidence(
        'image-name',
        'Nome sugere imagem',
        20,
        hasWord(f, 'image', 'img', 'photo', 'foto', 'avatar', 'thumbnail')
      )
    ]);
  if (type === 'text')
    return candidate(type, [evidence('text-node', 'TextNode real do Figma', 100, node.type === 'TEXT')]);
  if (type === 'grid')
    return candidate(type, [
      evidence('grid-api', 'Grid real ou estrutura de Grid', 80, f.grid),
      evidence('grid-name', 'Nome sugere grid', 20, hasWord(f, 'grid', 'grade'))
    ]);
  if (type === 'section')
    return candidate(type, [
      evidence('section-name', 'Nome sugere seção', 45, hasWord(f, 'section', 'secao', 'hero')),
      evidence('section-content', 'Possui múltiplos conteúdos', 25, f.childCount >= 2),
      evidence('section-layout', 'Layout de container', 15, f.autoLayout || f.grid),
      evidence('section-width', 'Dimensão de seção', 15, f.width >= 320)
    ]);
  return candidate('container', [
    evidence('container-children', 'Possui filhos', 45, f.childCount > 0),
    evidence('container-layout', 'Possui estrutura de layout', 35, f.autoLayout || f.grid),
    evidence('container-style', 'Possui superfície ou espaçamento', 20, f.hasBackground || f.hasPadding || f.hasGap)
  ]);
}

function candidates(node: ParsedNode, f: NodeFeatures): SemanticDecision[] {
  if (node.type === 'TEXT') return [fallbackCandidate('text', f, node)];
  if (
    node.codegen?.imageScaleMode !== undefined &&
    resolvedImageUsage(node) === 'image-element' &&
    node.children.length === 0
  )
    return [fallbackCandidate('image', f, node)];
  return [
    buttonCandidate(f),
    inputCandidate(f),
    formCandidate(f),
    cardCandidate(f),
    listCandidate(node, f),
    landmarkCandidate('navbar', f, ['nav', 'navbar', 'navigation', 'navegacao']),
    landmarkCandidate('sidebar', f, ['sidebar', 'aside', 'lateral']),
    landmarkCandidate('header', f, ['header', 'cabecalho']),
    landmarkCandidate('footer', f, ['footer', 'rodape']),
    fallbackCandidate('section', f, node),
    fallbackCandidate('grid', f, node),
    fallbackCandidate('container', f, node)
  ];
}

export function analyzeSemantics(node: ParsedNode): SemanticDecision {
  const f = features(node);
  const allCandidates = candidates(node, f);
  const fallback = allCandidates.find((item) => item.type === 'container');
  const ranked = allCandidates
    .filter((item) => item.type !== 'container')
    .sort((left, right) => right.confidence - left.confidence);
  let best = ranked[0] ?? { type: 'unknown' as const, confidence: 0, level: 'unknown' as const, evidence: [] };
  const runnerUp = ranked[1];
  const ambiguity = runnerUp && best.confidence - runnerUp.confidence < 0.06;
  const requiredButtonEvidence =
    best.type !== 'button' ||
    (f.textDescendants + f.iconChildren > 0 &&
      (f.autoLayout || f.componentLike || hasWord(f, 'button', 'btn', 'botao', 'cta')));
  let unsafe = !requiredButtonEvidence || (ambiguity && best.confidence < 0.75);
  if ((best.confidence < 0.55 || unsafe) && fallback && fallback.confidence >= 0.55) {
    best = fallback;
    unsafe = false;
  }
  if (best.confidence < 0.55 || unsafe)
    return {
      type: 'unknown',
      confidence: unsafe ? Math.min(best.confidence, 0.54) : best.confidence,
      level: 'unknown',
      evidence: best.evidence
    };
  return best;
}

function numericValue(node: ParsedNode, property: RegExp): number | undefined {
  const conversion = node.conversions.find((item) => property.test(item.property));
  const sourceNumber =
    conversion?.source && Object.values(conversion.source).find((value) => typeof value === 'number');
  if (typeof sourceNumber === 'number' && Number.isFinite(sourceNumber)) return sourceNumber;
  const match = conversion?.value.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/)?.[0];
  return match === undefined ? undefined : Number(match);
}

function conversionValue(node: ParsedNode, category: string, property: RegExp): string | undefined {
  return node.conversions.find((item) => item.category === category && property.test(item.property))?.value;
}

function smartLayout(node: ParsedNode): SmartLayout {
  const mode = node.codegen?.layoutMode;
  const display = mode === 'GRID' ? 'grid' : mode === 'HORIZONTAL' || mode === 'VERTICAL' ? 'flex' : 'block';
  const paddingAll = numericValue(node, /^padding$/);
  const horizontal = numericValue(node, /^padding horizontal$/);
  const vertical = numericValue(node, /^padding vertical$/);
  const top = numericValue(node, /^padding top$/) ?? vertical ?? paddingAll ?? 0;
  const right = numericValue(node, /^padding right$/) ?? horizontal ?? paddingAll ?? 0;
  const bottom = numericValue(node, /^padding bottom$/) ?? vertical ?? paddingAll ?? 0;
  const left = numericValue(node, /^padding left$/) ?? horizontal ?? paddingAll ?? 0;
  const hasPadding = top !== 0 || right !== 0 || bottom !== 0 || left !== 0;
  const gap = numericValue(node, /^gap(?:$|-)/);
  return {
    display,
    ...(mode === 'HORIZONTAL'
      ? { direction: 'row' as const }
      : mode === 'VERTICAL'
        ? { direction: 'column' as const }
        : {}),
    ...(gap !== undefined ? { gap } : {}),
    ...(hasPadding ? { padding: { top, right, bottom, left } } : {}),
    position: node.codegen?.layoutPositioning === 'ABSOLUTE' ? 'absolute' : 'flow',
    width: node.codegen?.width ?? 0,
    height: node.codegen?.height ?? 0
  };
}

function smartAppearance(node: ParsedNode): SmartAppearance {
  const background = conversionValue(node, 'background', /background color/);
  const textColor = conversionValue(node, 'typography', /text color/);
  const borderColor = conversionValue(node, 'border', /(?:border|outline) color/);
  const borderRadius = numericValue(node, /border radius/);
  const opacity = numericValue(node, /^opacity$/);
  const shadow = conversionValue(node, 'effects', /shadow/);
  const fontSize = numericValue(node, /font size/);
  const fontWeight = numericValue(node, /font weight/);
  return {
    ...(background ? { background } : {}),
    ...(textColor ? { textColor } : {}),
    ...(borderColor ? { borderColor } : {}),
    ...(borderRadius !== undefined ? { borderRadius } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(shadow ? { shadow } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(fontWeight !== undefined ? { fontWeight } : {})
  };
}

function defaultComponentName(node: ParsedNode, type: SemanticType): string | undefined {
  if (!['button', 'card', 'input', 'navbar', 'sidebar', 'form', 'list'].includes(type)) return undefined;
  if (!GENERIC_NAMES.test(node.name.trim())) {
    const words =
      node.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .match(/[A-Za-z0-9]+/g) ?? [];
    const value = words
      .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
      .join('')
      .slice(0, 60);
    if (value) return /^\d/.test(value) ? `Figma${value}` : value;
  }
  return `${type[0]!.toUpperCase()}${type.slice(1)}`;
}

export function toSmartNode(node: ParsedNode, children: SmartNode[] = []): SmartNode {
  const decision = analyzeSemantics(node);
  const componentName = defaultComponentName(node, decision.type);
  return {
    id: node.id,
    name: node.name,
    originalType: node.type,
    semanticType: decision.type,
    confidence: decision.confidence,
    confidenceLevel: decision.level,
    evidence: decision.evidence,
    layout: smartLayout(node),
    appearance: smartAppearance(node),
    structuralSignature: getStructuralSignature(node),
    reusable: node.type === 'COMPONENT' || node.type === 'INSTANCE',
    ...(componentName ? { componentName } : {}),
    children
  };
}
