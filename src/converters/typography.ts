import type { Conversion, Settings } from '../types';
import { arbitraryPx } from '../utils/tailwindScale';
import { arbitraryFontFamilyClass } from '../utils/arbitraryValues';

const sizes = new Map([
  [12, 'xs'],
  [14, 'sm'],
  [16, 'base'],
  [18, 'lg'],
  [20, 'xl'],
  [24, '2xl'],
  [30, '3xl'],
  [36, '4xl'],
  [48, '5xl'],
  [60, '6xl'],
  [72, '7xl'],
  [96, '8xl'],
  [128, '9xl']
]);
const weights: Readonly<Record<number, string>> = {
  100: 'thin',
  200: 'extralight',
  300: 'light',
  400: 'normal',
  500: 'medium',
  600: 'semibold',
  700: 'bold',
  800: 'extrabold',
  900: 'black'
};
const tracking = new Map<number, string>([
  [-0.05, 'tighter'],
  [-0.025, 'tight'],
  [0.025, 'wide'],
  [0.05, 'wider'],
  [0.1, 'widest']
]);
const textAlign: Readonly<Record<string, string>> = {
  LEFT: 'text-left',
  CENTER: 'text-center',
  RIGHT: 'text-right',
  JUSTIFIED: 'text-justify'
};
const leading = new Map([
  [12, '3'],
  [16, '4'],
  [20, '5'],
  [24, '6'],
  [28, '7'],
  [32, '8'],
  [36, '9'],
  [40, '10']
]);

export function fontSize(value: number, settings: Settings, lineHeightControlled = false): Conversion {
  if (!Number.isFinite(value) || value <= 0)
    return {
      category: 'typography',
      property: 'font size',
      value: String(value),
      classes: [],
      source: { fontSize: String(value) },
      fidelity: 'unsupported',
      note: 'Font-size deve ser um número positivo; nenhuma classe foi gerada.'
    };
  const standard = settings.preferDefaults && lineHeightControlled ? sizes.get(value) : undefined;
  const className = `text-${standard ?? `[${arbitraryPx(value, settings)}]`}`;
  return {
    category: 'typography',
    property: 'font size',
    value: `${value}px`,
    classes: [className],
    source: { fontSize: `${value}px` },
    fidelity: standard ? 'exact' : 'arbitrary',
    ...(!lineHeightControlled && sizes.has(value)
      ? {
          note: 'Tamanho arbitrário preserva font-size sem aplicar o line-height implícito de uma utility text-* padrão.'
        }
      : {})
  };
}

export function fontWeight(value: number): Conversion {
  if (!Number.isFinite(value) || value < 1 || value > 1000)
    return {
      category: 'typography',
      property: 'font weight',
      value: String(value),
      classes: [],
      source: { fontWeight: value },
      fidelity: 'unsupported',
      note: 'Font-weight deve estar entre 1 e 1000; nenhuma classe foi gerada.'
    };
  const standard = weights[value];
  return {
    category: 'typography',
    property: 'font weight',
    value: String(value),
    classes: [`font-${standard ?? `[${value}]`}`],
    source: { fontWeight: value },
    fidelity: standard ? 'exact' : 'arbitrary'
  };
}

export function fontFamily(value: string): Conversion {
  const normalized = value.trim().slice(0, 200);
  if (!normalized)
    return {
      category: 'typography',
      property: 'font family',
      value: 'invalid',
      classes: [],
      fidelity: 'unsupported',
      note: 'Nome de fonte vazio; nenhuma classe foi gerada.'
    };
  return {
    category: 'typography',
    property: 'font family',
    value: normalized,
    classes: [arbitraryFontFamilyClass(normalized)],
    source: { fontFamily: normalized },
    fidelity: 'arbitrary',
    note: 'Certifique-se de que a fonte esteja disponível no projeto Tailwind/CSS. Use um mapeamento explícito para trocar por font-sans ou outra utility configurada.'
  };
}

export function textAlignClass(value: string): string | null {
  return textAlign[value] ?? null;
}

export function letterSpacing(value: number, unit: 'PIXELS' | 'PERCENT', settings: Settings): Conversion | null {
  if (!Number.isFinite(value))
    return {
      category: 'typography',
      property: 'letter spacing',
      value: String(value),
      classes: [],
      fidelity: 'unsupported',
      note: 'Letter-spacing numericamente inválido; nenhuma classe foi gerada.'
    };
  if (value === 0) return null;
  const em = unit === 'PERCENT' ? value / 100 : null;
  const standard = settings.preferDefaults && em !== null ? tracking.get(em) : undefined;
  const cssValue = unit === 'PIXELS' ? arbitraryPx(value, settings) : `${Number((value / 100).toFixed(4))}em`;
  return {
    category: 'typography',
    property: 'letter spacing',
    value: cssValue,
    classes: [standard ? `tracking-${standard}` : `tracking-[${cssValue}]`],
    source: { letterSpacing: cssValue },
    fidelity: standard ? 'exact' : 'arbitrary'
  };
}

export function lineHeight(value: number, unit: 'PIXELS' | 'PERCENT', settings: Settings): Conversion {
  if (!Number.isFinite(value) || value < 0)
    return {
      category: 'typography',
      property: 'line height',
      value: String(value),
      classes: [],
      fidelity: 'unsupported',
      note: 'Line-height negativo ou numericamente inválido; nenhuma classe foi gerada.'
    };
  const cssValue = unit === 'PIXELS' ? arbitraryPx(value, settings) : `${Number(value.toFixed(4))}%`;
  const standard = unit === 'PIXELS' && settings.preferDefaults ? leading.get(value) : undefined;
  return {
    category: 'typography',
    property: 'line height',
    value: cssValue,
    classes: [standard ? `leading-${standard}` : `leading-[${cssValue}]`],
    source: { lineHeight: cssValue },
    fidelity: standard ? 'exact' : 'arbitrary'
  };
}

export function textTruncation(node: TextNode): Conversion | null {
  const enabled = node.textTruncation === 'ENDING' || node.textAutoResize === 'TRUNCATE';
  if (!enabled) return null;
  if (node.maxLines === 1)
    return {
      category: 'typography',
      property: 'text truncation',
      value: '1 line',
      classes: ['truncate'],
      fidelity: 'equivalent'
    };
  if (typeof node.maxLines === 'number' && Number.isInteger(node.maxLines) && node.maxLines > 1) {
    const className = node.maxLines <= 6 ? `line-clamp-${node.maxLines}` : `line-clamp-[${node.maxLines}]`;
    return {
      category: 'typography',
      property: 'text truncation',
      value: `${node.maxLines} lines`,
      classes: [className],
      fidelity: node.maxLines <= 6 ? 'equivalent' : 'arbitrary'
    };
  }
  return {
    category: 'typography',
    property: 'text truncation',
    value: 'ending',
    classes: [],
    fidelity: 'unsupported',
    note: 'Truncamento sem limite de linhas não possui uma utility Tailwind fiel e independente do contexto.'
  };
}

export function typography(node: TextNode, settings: Settings): Conversion[] {
  const result: Conversion[] = [];
  const explicitLineHeight = typeof node.lineHeight !== 'symbol' && node.lineHeight.unit !== 'AUTO';
  if (typeof node.fontSize === 'number') result.push(fontSize(node.fontSize, settings, explicitLineHeight));
  if (typeof node.fontWeight === 'number') result.push(fontWeight(node.fontWeight));
  const alignment = textAlignClass(node.textAlignHorizontal);
  if (alignment)
    result.push({
      category: 'typography',
      property: 'text align',
      value: node.textAlignHorizontal.toLowerCase(),
      classes: [alignment],
      fidelity: 'equivalent'
    });
  if (typeof node.fontName !== 'symbol') result.push(fontFamily(node.fontName.family));
  else
    result.push({
      category: 'typography',
      property: 'font family',
      value: 'mixed',
      classes: [],
      fidelity: 'unsupported',
      note: 'Fontes diferentes por trecho exigem spans separados; nenhuma classe global foi gerada.'
    });
  if (node.textDecoration === 'UNDERLINE')
    result.push({ category: 'typography', property: 'decoration', value: 'underline', classes: ['underline'] });
  if (node.textDecoration === 'STRIKETHROUGH')
    result.push({ category: 'typography', property: 'decoration', value: 'line-through', classes: ['line-through'] });
  if (typeof node.textCase !== 'symbol' && node.textCase !== 'ORIGINAL') {
    const cases: Readonly<Record<string, string>> = { UPPER: 'uppercase', LOWER: 'lowercase', TITLE: 'capitalize' };
    const className = cases[node.textCase];
    if (className)
      result.push({
        category: 'typography',
        property: 'text transform',
        value: node.textCase.toLowerCase(),
        classes: [className]
      });
  }
  if (typeof node.letterSpacing !== 'symbol') {
    const converted = letterSpacing(node.letterSpacing.value, node.letterSpacing.unit, settings);
    if (converted) result.push(converted);
  }
  if (typeof node.fontName !== 'symbol' && node.fontName.style.toLowerCase().includes('italic'))
    result.push({ category: 'typography', property: 'font style', value: 'italic', classes: ['italic'] });
  if (typeof node.lineHeight !== 'symbol' && node.lineHeight.unit !== 'AUTO')
    result.push(lineHeight(node.lineHeight.value, node.lineHeight.unit, settings));
  const truncation = textTruncation(node);
  if (truncation) result.push(truncation);
  return result;
}
