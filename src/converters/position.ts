import type { Conversion, Settings } from '../types';
import { utility } from '../utils/tailwindScale';

type AxisConstraint = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
export interface PositionNodeLike {
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  x: number;
  y: number;
  width: number;
  height: number;
  constraints?: { horizontal: AxisConstraint; vertical: AxisConstraint };
}
export interface ParentSize {
  width: number;
  height: number;
}
export interface PositioningContextNodeLike {
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  children?: ReadonlyArray<{ visible?: boolean; layoutPositioning?: 'AUTO' | 'ABSOLUTE' }>;
}

const offsetClass = (property: 'top' | 'right' | 'bottom' | 'left', value: number, settings: Settings): string => {
  const converted = utility(property, Math.abs(value), settings);
  return value < 0 ? `-${converted}` : converted;
};

function offset(
  property: 'top' | 'right' | 'bottom' | 'left',
  value: number,
  constraint: AxisConstraint,
  settings: Settings
): Conversion {
  return {
    category: 'position',
    property,
    value: `${value}px`,
    classes: [offsetClass(property, value, settings)],
    source: { [property]: value, constraint }
  };
}

export function positioning(
  node: PositionNodeLike,
  settings: Settings,
  parent?: ParentSize
): { converted: Conversion[]; unsupported: string[] } {
  if (node.layoutPositioning !== 'ABSOLUTE') return { converted: [], unsupported: [] };
  const converted: Conversion[] = [
    { category: 'position', property: 'position', value: 'absolute', classes: ['absolute'] }
  ];
  const unsupported: string[] = ['Este elemento usa posicionamento absoluto e exige um ancestral posicionado.'];
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
    unsupported.push('Offsets ou dimensões inválidos: top/left/right/bottom não foram gerados.');
    return { converted, unsupported };
  }
  const horizontal = node.constraints?.horizontal ?? 'MIN',
    vertical = node.constraints?.vertical ?? 'MIN';
  const validParent = parent && [parent.width, parent.height].every(Number.isFinite) ? parent : undefined;
  const right = validParent ? validParent.width - node.x - node.width : undefined;
  const bottom = validParent ? validParent.height - node.y - node.height : undefined;

  if (horizontal === 'MAX' && right !== undefined) converted.push(offset('right', right, horizontal, settings));
  else if (horizontal === 'STRETCH' && right !== undefined)
    converted.push(offset('left', node.x, horizontal, settings), offset('right', right, horizontal, settings));
  else {
    converted.push(offset('left', node.x, horizontal, settings));
    if (horizontal === 'CENTER' || horizontal === 'SCALE')
      unsupported.push(
        `Constraint horizontal ${horizontal.toLowerCase()}: left representa apenas a posição atual; revise o comportamento responsivo.`
      );
    else if ((horizontal === 'MAX' || horizontal === 'STRETCH') && right === undefined)
      unsupported.push(
        `Constraint horizontal ${horizontal.toLowerCase()}: tamanho do pai indisponível; foi usado left como fallback.`
      );
  }

  if (vertical === 'MAX' && bottom !== undefined) converted.push(offset('bottom', bottom, vertical, settings));
  else if (vertical === 'STRETCH' && bottom !== undefined)
    converted.push(offset('top', node.y, vertical, settings), offset('bottom', bottom, vertical, settings));
  else {
    converted.push(offset('top', node.y, vertical, settings));
    if (vertical === 'CENTER' || vertical === 'SCALE')
      unsupported.push(
        `Constraint vertical ${vertical.toLowerCase()}: top representa apenas a posição atual; revise o comportamento responsivo.`
      );
    else if ((vertical === 'MAX' || vertical === 'STRETCH') && bottom === undefined)
      unsupported.push(
        `Constraint vertical ${vertical.toLowerCase()}: tamanho do pai indisponível; foi usado top como fallback.`
      );
  }
  return { converted, unsupported };
}

export function positioningContext(value: unknown): Conversion[] {
  if (typeof value !== 'object' || value === null) return [];
  const node = value as PositioningContextNodeLike;
  let hasAbsoluteChild = false;
  const children = node.children ?? [];
  const maximumChecks = Math.min(children.length, 400);
  for (let index = 0; index < maximumChecks; index += 1) {
    const child = children[index];
    if (!child) continue;
    try {
      if (child.layoutPositioning === 'ABSOLUTE') {
        hasAbsoluteChild = true;
        break;
      }
    } catch {
      // The parser will separately report inaccessible children.
    }
  }
  if (node.layoutPositioning === 'ABSOLUTE' || !hasAbsoluteChild) return [];
  return [
    {
      category: 'position',
      property: 'positioning context',
      value: 'relative',
      classes: ['relative'],
      fidelity: 'equivalent',
      note: 'Cria o containing block necessário para os filhos com posicionamento absoluto.'
    }
  ];
}
