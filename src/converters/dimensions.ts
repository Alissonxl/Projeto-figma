import type { Conversion, Settings } from '../types';
import { semanticUtility } from '../utils/tailwindScale';

export type DimensionMode = 'auto' | 'fixed' | 'fill' | 'stretch';
export interface AxisBehavior {
  mode: DimensionMode;
  value: number;
}
export interface DimensionBehavior {
  width: AxisBehavior;
  height: AxisBehavior;
}
export interface DimensionNodeLike {
  type: string;
  width: number;
  height: number;
  textAutoResize?: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  layoutGrow?: number;
  layoutAlign?: string;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  constraints?: {
    horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
    vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  };
  parentLayoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
}

const sizingMode = (value: 'FIXED' | 'HUG' | 'FILL' | undefined, fallback: DimensionMode): DimensionMode =>
  value === 'HUG' ? 'auto' : value === 'FILL' ? 'fill' : value === 'FIXED' ? 'fixed' : fallback;

export function getDimensionBehavior(node: DimensionNodeLike): DimensionBehavior {
  let width: DimensionMode = 'fixed',
    height: DimensionMode = 'fixed';
  if (node.type === 'TEXT') {
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT') {
      width = 'auto';
      height = 'auto';
    } else if (node.textAutoResize === 'HEIGHT') height = 'auto';
    // NONE and TRUNCATE represent a fixed text box in the current API.
  }
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    const primaryAuto = node.primaryAxisSizingMode === 'AUTO',
      counterAuto = node.counterAxisSizingMode === 'AUTO';
    if (node.layoutMode === 'HORIZONTAL') {
      if (primaryAuto) width = 'auto';
      if (counterAuto) height = 'auto';
    } else {
      if (primaryAuto) height = 'auto';
      if (counterAuto) width = 'auto';
    }
  }
  width = sizingMode(node.layoutSizingHorizontal, width);
  height = sizingMode(node.layoutSizingVertical, height);
  if (node.layoutPositioning === 'ABSOLUTE') {
    if (node.constraints?.horizontal === 'STRETCH') width = 'stretch';
    if (node.constraints?.vertical === 'STRETCH') height = 'stretch';
  }
  return { width: { mode: width, value: node.width }, height: { mode: height, value: node.height } };
}

function axisConversion(
  axis: 'width' | 'height',
  behavior: AxisBehavior,
  node: DimensionNodeLike,
  settings: Settings,
  parentLayoutMode = node.parentLayoutMode
): Conversion {
  const label = axis === 'width' ? 'Largura' : 'Altura';
  const modeLabel =
    behavior.mode === 'auto'
      ? 'Automática'
      : behavior.mode === 'fill'
        ? 'Fill container'
        : behavior.mode === 'stretch'
          ? 'Stretch'
          : 'Fixa';
  const ignoreAuto = node.type !== 'TEXT' || settings.ignoreAutomaticTextDimensions;
  if (behavior.mode === 'auto' && ignoreAuto)
    return {
      category: 'dimensions',
      property: label,
      value: `${behavior.value}px (${modeLabel})`,
      classes: [],
      source: { [axis]: behavior.value, mode: behavior.mode },
      fidelity: 'ignored',
      note:
        node.type === 'TEXT'
          ? 'Ignorada: dimensão automática do texto.'
          : 'Ignorada: dimensão controlada por Hug Contents.'
    };
  if (behavior.mode === 'fill') {
    const isPrimary =
      (axis === 'width' && parentLayoutMode === 'HORIZONTAL') || (axis === 'height' && parentLayoutMode === 'VERTICAL');
    const safeClass =
      isPrimary && node.layoutGrow === 1 ? 'grow' : !isPrimary && node.layoutAlign === 'STRETCH' ? 'self-stretch' : '';
    return {
      category: safeClass ? 'layout' : 'dimensions',
      property: label,
      value: `${behavior.value}px (${modeLabel})`,
      classes: safeClass ? [safeClass] : [],
      source: { [axis]: behavior.value, mode: behavior.mode },
      fidelity: safeClass ? 'equivalent' : 'ignored',
      note: safeClass
        ? 'Convertida a partir do comportamento Fill Container.'
        : 'Fill Container detectado; nenhuma classe foi inferida sem evidência adicional.'
    };
  }
  if (behavior.mode === 'stretch')
    return {
      category: 'dimensions',
      property: label,
      value: `${behavior.value}px (${modeLabel})`,
      classes: [],
      source: { [axis]: behavior.value, mode: behavior.mode },
      fidelity: 'ignored',
      note:
        axis === 'width'
          ? 'Largura controlada por left + right devido ao constraint Stretch; w-* seria conflitante.'
          : 'Altura controlada por top + bottom devido ao constraint Stretch; h-* seria conflitante.'
    };
  const converted = dimension(axis, behavior.value, settings);
  return {
    ...converted,
    property: label,
    value: `${behavior.value}px (${modeLabel})`,
    source: { [axis]: behavior.value, mode: behavior.mode }
  };
}

export function nodeDimensions(
  node: DimensionNodeLike,
  settings: Settings,
  parentLayoutMode = node.parentLayoutMode
): Conversion[] {
  const behavior = getDimensionBehavior(node);
  return [
    axisConversion('width', behavior.width, node, settings, parentLayoutMode),
    axisConversion('height', behavior.height, node, settings, parentLayoutMode)
  ];
}

export function dimension(
  property: 'width' | 'height' | 'min-width' | 'max-width' | 'min-height' | 'max-height',
  value: number | 'full' | 'half',
  settings: Settings
): Conversion {
  const prefixes = {
    width: 'w',
    height: 'h',
    'min-width': 'min-w',
    'max-width': 'max-w',
    'min-height': 'min-h',
    'max-height': 'max-h'
  } as const;
  const suffix = value === 'full' ? 'full' : value === 'half' ? '1/2' : undefined;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
    return {
      category: 'dimensions',
      property,
      value: `${value}px`,
      classes: [],
      fidelity: 'unsupported',
      note: 'Dimensão negativa ou numericamente inválida; nenhuma classe foi gerada.'
    };
  if (suffix)
    return {
      category: 'dimensions',
      property,
      value: String(value),
      classes: [`${prefixes[property]}-${suffix}`],
      fidelity: 'equivalent'
    };
  const converted = semanticUtility(property, prefixes[property], value as number, settings);
  return {
    category: 'dimensions',
    property,
    value: `${value}px`,
    classes: [converted.className],
    utility: converted,
    fidelity: converted.fidelity
  };
}
