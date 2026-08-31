import type { Conversion, Settings } from '../types';
import { arbitraryPx, utility } from '../utils/tailwindScale';
import { dialectFor } from '../utils/tailwindDialect';

const BOX_STROKE_TYPES = new Set<SceneNode['type']>([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'RECTANGLE',
  'ELLIPSE',
  'SECTION'
]);
interface StrokeWeights {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
const isStrokeWeights = (value: unknown): value is StrokeWeights =>
  typeof value === 'object' &&
  value !== null &&
  ['top', 'right', 'bottom', 'left'].every((key) => typeof (value as Record<string, unknown>)[key] === 'number');
const borderWidth = (prefix: string, value: number, settings: Settings): string => {
  if (settings.preferDefaults) {
    if (value === 0) return `${prefix}-0`;
    if (value === 1) return prefix;
    if ([2, 4, 8].includes(value)) return `${prefix}-${value}`;
  }
  return `${prefix}-[${arbitraryPx(value, settings)}]`;
};
function radiusClass(prefix: string, value: number, settings: Settings): string {
  const mapped = settings.preferDefaults ? dialectFor(settings).radii.get(value) : undefined;
  if (mapped !== undefined) return mapped ? `${prefix}-${mapped}` : prefix;
  return utility(prefix, value, settings);
}

export function hasVisibleStroke(node: SceneNode): boolean {
  if (
    !('strokes' in node) ||
    !Array.isArray(node.strokes) ||
    !node.strokes.some((stroke) => stroke.visible !== false && (stroke.opacity ?? 1) > 0.001)
  )
    return false;
  if ('individualStrokeWeights' in node && isStrokeWeights(node.individualStrokeWeights))
    return Object.values(node.individualStrokeWeights).some((value) => value > 0);
  return 'strokeWeight' in node && typeof node.strokeWeight === 'number' && node.strokeWeight > 0;
}

export function supportsBoxStroke(node: SceneNode): boolean {
  return BOX_STROKE_TYPES.has(node.type);
}
export function hasCustomDashPattern(node: SceneNode): boolean {
  return 'dashPattern' in node && node.dashPattern.some((value) => value > 0);
}

export function isFullEllipse(node: SceneNode): boolean {
  if (node.type !== 'ELLIPSE') return false;
  if (!('arcData' in node) || !node.arcData) return true;
  const { startingAngle, endingAngle, innerRadius } = node.arcData;
  const sweep = Math.abs(endingAngle - startingAngle);
  return Math.abs(sweep - Math.PI * 2) < 0.001 && Math.abs(innerRadius) < 0.001;
}

export function usesInnerOutline(node: SceneNode): boolean {
  if (
    !supportsBoxStroke(node) ||
    !hasVisibleStroke(node) ||
    !('strokeAlign' in node) ||
    node.strokeAlign !== 'INSIDE' ||
    !('strokeWeight' in node) ||
    typeof node.strokeWeight !== 'number'
  )
    return false;
  if (!('individualStrokeWeights' in node) || !isStrokeWeights(node.individualStrokeWeights)) return true;
  const weights = node.individualStrokeWeights;
  return weights.top === weights.right && weights.right === weights.bottom && weights.bottom === weights.left;
}

function outlineWidthClasses(value: number, settings: Settings): string[] {
  const width =
    settings.preferDefaults && [1, 2, 4, 8].includes(value)
      ? `outline-${value}`
      : `outline-[${arbitraryPx(value, settings)}]`;
  return [dialectFor(settings).outlineStyleClass, width, `outline-offset-[-${arbitraryPx(value, settings)}]`];
}

export function borderWidthClasses(
  top: number,
  right: number,
  bottom: number,
  left: number,
  settings: Settings
): string[] {
  if (top === right && right === bottom && bottom === left)
    return top > 0 ? [borderWidth('border', top, settings)] : [];
  const classes: string[] = [];
  if (left === right) {
    if (left > 0) classes.push(borderWidth('border-x', left, settings));
  } else {
    if (left > 0) classes.push(borderWidth('border-l', left, settings));
    if (right > 0) classes.push(borderWidth('border-r', right, settings));
  }
  if (top === bottom) {
    if (top > 0) classes.push(borderWidth('border-y', top, settings));
  } else {
    if (top > 0) classes.push(borderWidth('border-t', top, settings));
    if (bottom > 0) classes.push(borderWidth('border-b', bottom, settings));
  }
  return classes;
}

export function borders(node: SceneNode, settings: Settings): Conversion[] {
  const result: Conversion[] = [];
  const customDash = hasCustomDashPattern(node);
  const visibleStroke = supportsBoxStroke(node) && hasVisibleStroke(node) && !customDash;
  if (customDash && hasVisibleStroke(node)) {
    const pattern = 'dashPattern' in node ? node.dashPattern : [];
    result.push({
      category: 'border',
      property: 'dash pattern',
      value: pattern.join(' '),
      classes: [],
      fidelity: 'unsupported',
      note: 'Padrões de traço personalizados do Figma não possuem equivalência CSS/Tailwind exata.'
    });
  }
  if (visibleStroke) {
    if (usesInnerOutline(node) && 'strokeWeight' in node && typeof node.strokeWeight === 'number') {
      result.push({
        category: 'border',
        property: 'inside stroke',
        value: `${node.strokeWeight}px`,
        classes: outlineWidthClasses(node.strokeWeight, settings),
        source: { strokeWeight: node.strokeWeight, strokeAlign: 'INSIDE' },
        note: 'Convertido para outline interno sem alterar as dimensões da caixa.'
      });
    } else if ('individualStrokeWeights' in node && isStrokeWeights(node.individualStrokeWeights)) {
      const weights = node.individualStrokeWeights;
      const classes = borderWidthClasses(weights.top, weights.right, weights.bottom, weights.left, settings);
      const approximateAlignment = 'strokeAlign' in node && node.strokeAlign !== 'INSIDE';
      if (classes.length)
        result.push({
          category: 'border',
          property: 'border widths',
          value: `${weights.top}px ${weights.right}px ${weights.bottom}px ${weights.left}px`,
          classes,
          source: { top: weights.top, right: weights.right, bottom: weights.bottom, left: weights.left },
          ...(approximateAlignment
            ? {
                fidelity: 'approximation' as const,
                note: `Stroke ${node.strokeAlign.toLowerCase()} aproximado com border; o modelo geométrico do CSS é diferente.`
              }
            : {})
        });
    } else if ('strokeWeight' in node && typeof node.strokeWeight === 'number' && node.strokeWeight > 0) {
      const approximateAlignment = 'strokeAlign' in node && node.strokeAlign !== 'INSIDE';
      result.push({
        category: 'border',
        property: 'border width',
        value: `${node.strokeWeight}px`,
        classes: [borderWidth('border', node.strokeWeight, settings)],
        ...(approximateAlignment
          ? {
              fidelity: 'approximation' as const,
              note: `Stroke ${node.strokeAlign.toLowerCase()} aproximado com border; o modelo geométrico do CSS é diferente.`
            }
          : {})
      });
    }
  }
  if (isFullEllipse(node))
    result.push({
      category: 'border',
      property: 'shape',
      value: 'ellipse',
      classes: ['rounded-full'],
      source: { shape: 'ellipse' },
      fidelity: 'equivalent'
    });
  else if (node.type === 'ELLIPSE')
    result.push({
      category: 'border',
      property: 'shape',
      value: 'partial ellipse',
      classes: [],
      fidelity: 'unsupported',
      note: 'Arcos e elipses parciais não podem ser representados por rounded-full.'
    });
  else if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0)
    result.push({
      category: 'border',
      property: 'border radius',
      value: `${node.cornerRadius}px`,
      classes: [radiusClass('rounded', node.cornerRadius, settings)]
    });
  else if ('topLeftRadius' in node) {
    const values: [string, number][] = [
      ['rounded-tl', node.topLeftRadius],
      ['rounded-tr', node.topRightRadius],
      ['rounded-br', node.bottomRightRadius],
      ['rounded-bl', node.bottomLeftRadius]
    ];
    for (const [prefix, value] of values)
      if (value > 0)
        result.push({
          category: 'border',
          property: prefix,
          value: `${value}px`,
          classes: [radiusClass(prefix, value, settings)]
        });
  }
  return result;
}
