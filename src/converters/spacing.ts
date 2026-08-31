import type { Conversion, Settings } from '../types';
import { semanticUtility } from '../utils/tailwindScale';

export function padding(top: number, right: number, bottom: number, left: number, settings: Settings): Conversion[] {
  const result: Conversion[] = [];
  const add = (property: string, value: number, prefix: string): void => {
    if (!Number.isFinite(value) || value < 0) {
      result.push({
        category: 'spacing',
        property,
        value: String(value),
        classes: [],
        fidelity: 'unsupported',
        note: 'Padding negativo ou numericamente inválido não possui representação CSS válida.'
      });
      return;
    }
    const converted = semanticUtility(property, prefix, value, settings);
    result.push({
      category: 'spacing',
      property,
      value: `${value}px`,
      classes: value === 0 ? [] : [converted.className],
      utility: converted,
      fidelity: value === 0 ? 'ignored' : converted.fidelity,
      ...(value === 0 ? { note: 'Valor padrão; nenhuma classe necessária.' } : {})
    });
  };
  if (top === right && right === bottom && bottom === left) add('padding', top, 'p');
  else {
    if (left === right) add('padding horizontal', left, 'px');
    else {
      add('padding left', left, 'pl');
      add('padding right', right, 'pr');
    }
    if (top === bottom) add('padding vertical', top, 'py');
    else {
      add('padding top', top, 'pt');
      add('padding bottom', bottom, 'pb');
    }
  }
  return result;
}

export function gap(value: number, settings: Settings, axis: 'gap' | 'gap-x' | 'gap-y' = 'gap'): Conversion {
  if (!Number.isFinite(value) || value < 0)
    return {
      category: 'spacing',
      property: axis,
      value: String(value),
      classes: [],
      fidelity: 'unsupported',
      note: 'CSS gap não aceita valores negativos ou numericamente inválidos; nenhuma classe foi gerada.'
    };
  if (value === 0)
    return {
      category: 'spacing',
      property: axis,
      value: '0px',
      classes: [],
      fidelity: 'ignored',
      note: 'Gap zero é o comportamento padrão; nenhuma classe necessária.'
    };
  const converted = semanticUtility(axis, axis, value, settings);
  return {
    category: 'spacing',
    property: axis,
    value: `${value}px`,
    classes: [converted.className],
    utility: converted,
    fidelity: converted.fidelity
  };
}
