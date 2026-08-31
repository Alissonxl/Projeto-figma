import type {
  ParsedNode,
  ResponsiveBreakpoint,
  ResponsiveCompareSettings,
  ResponsiveNodeMatch,
  ResponsiveSuggestion,
  ResponsiveSuggestionFidelity,
  Settings
} from '../types';
import { confidenceLevel } from './matchScoring';
import { utility } from '../utils/tailwindScale';

interface PropertyValue {
  property: string;
  className: string;
  risk: 'safe' | 'high';
}

const FONT_SIZE =
  /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[(?:(?:-?\d*\.?\d+)(?:px|rem|em|%|ch|vw|vh)|length:var\(--[^\]]+\)|(?:calc|clamp|min|max)\([^\]]+\))\])$/;
const COLOR_NAME =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00)';
const COLOR_VALUE = `(?:white|black|transparent|current|inherit|${COLOR_NAME}|\\[(?:#|rgba?\\(|hsla?\\(|oklch\\(|color:)[^\\]]+\\])`;
const TEXT_COLOR = new RegExp(`^text-${COLOR_VALUE}$`);
const BACKGROUND_COLOR = new RegExp(`^bg-${COLOR_VALUE}$`);
const BORDER_COLOR = new RegExp(`^border-${COLOR_VALUE}$`);
const WIDTH_FRACTIONS: readonly [number, string][] = [
  [1, 'w-full'],
  [1 / 2, 'w-1/2'],
  [1 / 3, 'w-1/3'],
  [2 / 3, 'w-2/3'],
  [1 / 4, 'w-1/4'],
  [3 / 4, 'w-3/4'],
  [1 / 5, 'w-1/5'],
  [2 / 5, 'w-2/5'],
  [3 / 5, 'w-3/5'],
  [4 / 5, 'w-4/5']
];

export function responsiveClassProperty(value: string): string | null {
  return responsiveClassProperties(value)[0] ?? null;
}

export function responsiveClassProperties(value: string): string[] {
  const spacing = spacingProperties(value);
  if (spacing.length) return spacing;
  const radius = borderRadiusProperties(value);
  if (radius.length) return radius;
  if (/^size-/.test(value)) return ['width', 'height'];
  const parsed = propertyValue(value);
  return parsed ? [parsed.property] : [];
}

function borderRadiusProperties(value: string): string[] {
  const mappings: readonly [RegExp, readonly string[]][] = [
    [/^rounded-tl(?:-|$)/, ['border-top-left-radius']],
    [/^rounded-tr(?:-|$)/, ['border-top-right-radius']],
    [/^rounded-br(?:-|$)/, ['border-bottom-right-radius']],
    [/^rounded-bl(?:-|$)/, ['border-bottom-left-radius']],
    [/^rounded-t(?:-|$)/, ['border-top-left-radius', 'border-top-right-radius']],
    [/^rounded-r(?:-|$)/, ['border-top-right-radius', 'border-bottom-right-radius']],
    [/^rounded-b(?:-|$)/, ['border-bottom-right-radius', 'border-bottom-left-radius']],
    [/^rounded-l(?:-|$)/, ['border-top-left-radius', 'border-bottom-left-radius']],
    [
      /^rounded(?:-|$)/,
      ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
    ]
  ];
  return mappings.find(([pattern]) => pattern.test(value))?.[1].slice() ?? [];
}

function spacingProperties(value: string): string[] {
  const normalized = value.startsWith('-') ? value.slice(1) : value;
  const mappings: readonly [string, readonly string[]][] = [
    ['px-', ['padding-left', 'padding-right']],
    ['py-', ['padding-top', 'padding-bottom']],
    ['pt-', ['padding-top']],
    ['pr-', ['padding-right']],
    ['pb-', ['padding-bottom']],
    ['pl-', ['padding-left']],
    ['p-', ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']],
    ['mx-', ['margin-left', 'margin-right']],
    ['my-', ['margin-top', 'margin-bottom']],
    ['mt-', ['margin-top']],
    ['mr-', ['margin-right']],
    ['mb-', ['margin-bottom']],
    ['ml-', ['margin-left']],
    ['m-', ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']],
    ['gap-x-', ['column-gap']],
    ['gap-y-', ['row-gap']],
    ['gap-', ['column-gap', 'row-gap']]
  ];
  return mappings.find(([prefix]) => normalized.startsWith(prefix))?.[1].slice() ?? [];
}

function propertyValue(value: string): PropertyValue | null {
  if (['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden'].includes(value))
    return { property: 'display', className: value, risk: 'safe' };
  if (/^flex-(?:row|row-reverse|col|col-reverse)$/.test(value))
    return { property: 'flex-direction', className: value, risk: 'safe' };
  if (/^flex-(?:wrap|nowrap|wrap-reverse)$/.test(value))
    return { property: 'flex-wrap', className: value, risk: 'safe' };
  if (/^justify-/.test(value)) return { property: 'justify-content', className: value, risk: 'safe' };
  if (/^items-/.test(value)) return { property: 'align-items', className: value, risk: 'safe' };
  if (/^content-/.test(value)) return { property: 'align-content', className: value, risk: 'safe' };
  if (/^w-/.test(value)) return { property: 'width', className: value, risk: 'safe' };
  if (/^h-/.test(value)) return { property: 'height', className: value, risk: 'safe' };
  if (/^min-w-/.test(value)) return { property: 'min-width', className: value, risk: 'safe' };
  if (/^max-w-/.test(value)) return { property: 'max-width', className: value, risk: 'safe' };
  if (/^min-h-/.test(value)) return { property: 'min-height', className: value, risk: 'safe' };
  if (/^max-h-/.test(value)) return { property: 'max-height', className: value, risk: 'safe' };
  if (/^size-/.test(value)) return { property: 'size', className: value, risk: 'safe' };
  if (/^grid-cols-/.test(value)) return { property: 'grid-template-columns', className: value, risk: 'safe' };
  if (/^grid-rows-/.test(value)) return { property: 'grid-template-rows', className: value, risk: 'safe' };
  if (FONT_SIZE.test(value)) return { property: 'font-size', className: value, risk: 'safe' };
  if (/^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[1-9]00\])$/.test(value))
    return { property: 'font-weight', className: value, risk: 'safe' };
  if (/^font-(?:sans|serif|mono|\['[^']+'\]|\[[^\]]+\])$/.test(value))
    return { property: 'font-family', className: value, risk: 'high' };
  if (/^leading-/.test(value)) return { property: 'line-height', className: value, risk: 'safe' };
  if (/^tracking-/.test(value)) return { property: 'letter-spacing', className: value, risk: 'safe' };
  if (/^(?:italic|not-italic)$/.test(value)) return { property: 'font-style', className: value, risk: 'safe' };
  if (/^(?:uppercase|lowercase|capitalize|normal-case)$/.test(value))
    return { property: 'text-transform', className: value, risk: 'safe' };
  if (/^(?:underline|overline|line-through|no-underline)$/.test(value))
    return { property: 'text-decoration', className: value, risk: 'safe' };
  if (/^text-(?:left|center|right|justify|start|end)$/.test(value))
    return { property: 'text-align', className: value, risk: 'safe' };
  if (TEXT_COLOR.test(value)) return { property: 'text-color', className: value, risk: 'safe' };
  if (BACKGROUND_COLOR.test(value)) return { property: 'background-color', className: value, risk: 'safe' };
  if (BORDER_COLOR.test(value)) return { property: 'border-color', className: value, risk: 'safe' };
  if (/^opacity-/.test(value)) return { property: 'opacity', className: value, risk: 'safe' };
  if (/^order-/.test(value)) return { property: 'order', className: value, risk: 'safe' };
  if (/^aspect-/.test(value)) return { property: 'aspect-ratio', className: value, risk: 'safe' };
  if (/^(?:absolute|relative|fixed|sticky|static)$/.test(value))
    return { property: 'position', className: value, risk: 'high' };
  if (/^(?:-)?(?:top|right|bottom|left|inset)(?:-|$)/.test(value))
    return { property: `offset:${value.replace(/^-/, '').split('-')[0]}`, className: value, risk: 'high' };
  if (/^z-/.test(value)) return { property: 'z-index', className: value, risk: 'high' };
  if (/^-?(?:rotate|scale|translate|skew|origin)-/.test(value))
    return { property: 'transform', className: value, risk: 'high' };
  if (/^(?:mix-blend|bg-blend)-/.test(value)) return { property: 'blend-mode', className: value, risk: 'high' };
  if (/^(?:mask|backdrop|blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia)-/.test(value))
    return { property: 'visual-effect', className: value, risk: 'high' };
  if (/^shadow(?:-|$)/.test(value)) return { property: 'box-shadow', className: value, risk: 'high' };
  return null;
}

function propertyMap(node: ParsedNode, settings: ResponsiveCompareSettings): Map<string, PropertyValue> {
  const result = new Map<string, PropertyValue>();
  for (const className of node.classes) {
    const properties = responsiveClassProperties(className);
    const risk = className.startsWith('-m') ? 'high' : 'safe';
    if (properties.length) {
      const parsed = propertyValue(className);
      for (const property of properties)
        result.set(property, {
          property,
          className,
          risk: verifiedEffectClass(node, className, property) ? 'safe' : (parsed?.risk ?? risk)
        });
    } else {
      const value = propertyValue(className);
      if (value)
        result.set(value.property, {
          ...value,
          risk: verifiedEffectClass(node, className, value.property) ? 'safe' : value.risk
        });
    }
  }
  const width = proportionalWidth(node, settings.percentageTolerance);
  if (width) result.set('width', { property: 'width', className: width, risk: 'safe' });
  return result;
}

function verifiedEffectClass(node: ParsedNode, className: string, property: string): boolean {
  if (property !== 'box-shadow') return false;
  return node.conversions.some(
    (conversion) =>
      conversion.category === 'effects' &&
      conversion.classes.includes(className) &&
      ['exact', 'equivalent', 'arbitrary'].includes(conversion.fidelity ?? '')
  );
}

function proportionalWidth(node: ParsedNode, tolerance: number): string | null {
  if (node.type === 'TEXT' && !node.classes.some((value) => /^(?:size|w|min-w|max-w)-/.test(value))) return null;
  const width = node.codegen?.width;
  const parentWidth = node.codegen?.parentWidth;
  if (!Number.isFinite(width) || !Number.isFinite(parentWidth) || !parentWidth || parentWidth <= 0) return null;
  const ratio = width! / parentWidth;
  return WIDTH_FRACTIONS.find(([fraction]) => Math.abs(fraction - ratio) <= tolerance)?.[1] ?? null;
}

function resetClass(property: string): string | null {
  const resets: Readonly<Record<string, string>> = {
    display: 'block',
    'flex-direction': 'flex-row',
    'flex-wrap': 'flex-nowrap',
    'justify-content': 'justify-start',
    'align-items': 'items-stretch',
    'align-content': 'content-normal',
    gap: 'gap-0',
    'column-gap': 'gap-x-0',
    'row-gap': 'gap-y-0',
    padding: 'p-0',
    'padding-x': 'px-0',
    'padding-y': 'py-0',
    'padding-top': 'pt-0',
    'padding-right': 'pr-0',
    'padding-bottom': 'pb-0',
    'padding-left': 'pl-0',
    'text-align': 'text-left',
    'font-style': 'not-italic',
    'text-transform': 'normal-case',
    'text-decoration': 'no-underline',
    'border-radius': 'rounded-none',
    'border-top-left-radius': 'rounded-tl-none',
    'border-top-right-radius': 'rounded-tr-none',
    'border-bottom-right-radius': 'rounded-br-none',
    'border-bottom-left-radius': 'rounded-bl-none',
    order: 'order-none',
    'aspect-ratio': 'aspect-auto',
    'box-shadow': 'shadow-none',
    'min-width': 'min-w-0',
    'max-width': 'max-w-none'
  };
  return resets[property] ?? null;
}

function explicitLayout(node: ParsedNode): boolean {
  return !!node.codegen && node.codegen.layoutMode !== 'NONE';
}

function sourceAndFidelity(
  property: string,
  reference: ParsedNode,
  target: ParsedNode,
  risk: PropertyValue['risk'],
  targetClass: string
): { source: string; fidelity: ResponsiveSuggestionFidelity } {
  if (risk === 'high') return { source: 'high-risk-property', fidelity: 'review' };
  if (
    ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'row-gap', 'column-gap'].includes(property) ||
    property.startsWith('padding-')
  )
    return explicitLayout(target)
      ? { source: 'auto-layout', fidelity: 'exact' }
      : { source: 'layout-heuristic', fidelity: 'suggestion' };
  if (property.startsWith('grid-'))
    return reference.codegen?.layoutMode === 'GRID' && target.codegen?.layoutMode === 'GRID'
      ? { source: 'figma-grid', fidelity: 'exact' }
      : { source: 'grid-heuristic', fidelity: 'review' };
  if (
    [
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'font-style',
      'text-transform',
      'text-decoration'
    ].includes(property)
  )
    return { source: 'figma-typography', fidelity: 'exact' };
  if (['text-color', 'background-color', 'border-color', 'opacity'].includes(property))
    return { source: 'figma-visual-property', fidelity: 'exact' };
  if (property === 'box-shadow') return { source: 'figma-effects', fidelity: 'equivalent' };
  if (property === 'width')
    return /^(?:w-full|w-[1-9]\/[1-9])$/.test(targetClass)
      ? { source: 'parent-proportion', fidelity: 'equivalent' }
      : { source: 'figma-dimensions', fidelity: 'exact' };
  return { source: 'figma-properties', fidelity: 'exact' };
}

function shouldApply(
  property: string,
  fidelity: ResponsiveSuggestionFidelity,
  settings: ResponsiveCompareSettings
): boolean {
  if (fidelity === 'review') return false;
  if (fidelity === 'suggestion' && !settings.allowHeuristicLayoutChanges) return false;
  if (
    [
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'font-style',
      'text-transform',
      'text-decoration'
    ].includes(property)
  )
    return settings.allowTypographyResponsive;
  return true;
}

export function compareResponsiveNodes(
  baseNode: ParsedNode,
  referenceNode: ParsedNode,
  targetNode: ParsedNode,
  targetFrameId: string,
  breakpoint: Exclude<ResponsiveBreakpoint, 'base'>,
  match: ResponsiveNodeMatch,
  settings: ResponsiveCompareSettings
): ResponsiveSuggestion[] {
  const base = propertyMap(baseNode, settings);
  const reference = propertyMap(referenceNode, settings);
  const target = propertyMap(targetNode, settings);
  const properties = new Set([...reference.keys(), ...target.keys()]);
  const suggestions: ResponsiveSuggestion[] = [];
  for (const property of properties) {
    const previous = reference.get(property);
    const next = target.get(property);
    if (previous?.className === next?.className) continue;
    const nextClass = next?.className ?? resetClass(property);
    if (!nextClass) {
      suggestions.push({
        id: `${targetFrameId}:${baseNode.id}:${property}`,
        baseNodeId: baseNode.id,
        targetNodeId: targetNode.id,
        targetFrameId,
        nodeName: baseNode.name,
        property,
        baseValue: previous?.className ?? 'padrão/não definido',
        targetValue: 'padrão/não definido',
        breakpoint,
        classes: previous ? [previous.className] : [],
        confidence: Number((match.confidence * 0.75).toFixed(3)),
        level: 'review',
        fidelity: 'review',
        source: 'missing-safe-reset',
        applied: false,
        note: 'A propriedade desapareceu no variant e não possui reset Tailwind seguro conhecido.'
      });
      continue;
    }
    const evidence = sourceAndFidelity(
      property,
      referenceNode,
      targetNode,
      previous?.risk === 'high' || next?.risk === 'high' ? 'high' : 'safe',
      nextClass
    );
    const confidence = Number(
      Math.max(
        0,
        Math.min(
          1,
          match.confidence * (evidence.fidelity === 'exact' ? 1 : evidence.fidelity === 'equivalent' ? 0.96 : 0.82)
        )
      ).toFixed(3)
    );
    const applied = shouldApply(property, evidence.fidelity, settings) && confidence >= settings.minimumMatchConfidence;
    suggestions.push({
      id: `${targetFrameId}:${baseNode.id}:${property}`,
      baseNodeId: baseNode.id,
      targetNodeId: targetNode.id,
      targetFrameId,
      nodeName: baseNode.name,
      property,
      baseValue: previous?.className ?? 'padrão/não definido',
      targetValue: nextClass,
      breakpoint,
      classes: unique([...(base.get(property) ? [base.get(property)!.className] : []), `${breakpoint}:${nextClass}`]),
      confidence,
      level: evidence.fidelity === 'review' ? 'review' : confidenceLevel(confidence, evidence.fidelity === 'exact'),
      fidelity: evidence.fidelity,
      source: evidence.source,
      applied,
      ...(!applied && evidence.fidelity === 'suggestion'
        ? { note: 'Mudança heurística detectada; habilite alterações heurísticas para aplicá-la automaticamente.' }
        : {})
    });
  }
  const referenceVisible = referenceNode.codegen?.visible !== false;
  const targetVisible = targetNode.codegen?.visible !== false;
  if (referenceVisible !== targetVisible) {
    const baseVisible = baseNode.codegen?.visible !== false;
    const confidence = match.confidence;
    suggestions.push({
      id: `${targetFrameId}:${baseNode.id}:visibility`,
      baseNodeId: baseNode.id,
      targetNodeId: targetNode.id,
      targetFrameId,
      nodeName: baseNode.name,
      property: 'visibility',
      baseValue: referenceVisible ? 'visível' : 'oculto',
      targetValue: targetVisible ? 'visível' : 'oculto',
      breakpoint,
      classes: unique([
        ...(baseVisible ? [] : ['hidden']),
        `${breakpoint}:${targetVisible ? displayClass(targetNode) : 'hidden'}`
      ]),
      confidence,
      level: confidenceLevel(confidence, true),
      fidelity: 'exact',
      source: 'figma-visibility',
      applied: confidence >= settings.minimumMatchConfidence
    });
  }
  return suggestions;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function displayClass(node: ParsedNode): string {
  if (node.codegen?.layoutMode === 'GRID') return 'grid';
  if (node.codegen?.layoutMode === 'HORIZONTAL' || node.codegen?.layoutMode === 'VERTICAL') return 'flex';
  return 'block';
}

export function maxWidthSuggestion(
  baseNode: ParsedNode,
  targetNode: ParsedNode,
  targetFrameId: string,
  breakpoint: Exclude<ResponsiveBreakpoint, 'base'>,
  match: ResponsiveNodeMatch,
  settings: Settings
): ResponsiveSuggestion | null {
  if (baseNode.type === 'TEXT' || targetNode.type === 'TEXT') return null;
  const base = baseNode.codegen;
  const target = targetNode.codegen;
  if (!base?.parentWidth || !target?.parentWidth || base.width <= 0 || target.width <= 0) return null;
  const baseRatio = base.width / base.parentWidth;
  const targetRatio = target.width / target.parentWidth;
  const absoluteGrowth = target.width / base.width;
  if (baseRatio < 0.75 || targetRatio > 0.45 || absoluteGrowth < 1 || absoluteGrowth > 1.35) return null;
  return {
    id: `${targetFrameId}:${baseNode.id}:max-width-heuristic`,
    baseNodeId: baseNode.id,
    targetNodeId: targetNode.id,
    targetFrameId,
    nodeName: baseNode.name,
    property: 'max-width',
    baseValue: `${Math.round(base.width)}px de ${Math.round(base.parentWidth)}px`,
    targetValue: `${Math.round(target.width)}px de ${Math.round(target.parentWidth)}px`,
    breakpoint,
    classes: ['w-full', utility('max-w', target.width, settings)],
    confidence: Number((match.confidence * 0.82).toFixed(3)),
    level: 'suggestion',
    fidelity: 'suggestion',
    source: 'max-width-heuristic',
    applied: false,
    note: 'Possível largura máxima; confirme se o elemento deve permanecer centralizado/fixo no desktop.'
  };
}
