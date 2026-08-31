import { validateTailwindUtility } from '../utils/classValidation';

export interface TailwindOptimizationResult {
  classes: string[];
  issues: string[];
  conflicts: Array<{ removed: string; kept: string; properties: string[] }>;
}

interface ParsedUtility {
  original: string;
  variant: string;
  base: string;
  properties: string[];
}

function splitVariant(value: string): { variant: string; base: string } {
  let depth = 0;
  let separator = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') index += 1;
    else if (character === '[' || character === '(') depth += 1;
    else if (character === ']' || character === ')') depth = Math.max(0, depth - 1);
    else if (character === ':' && depth === 0) separator = index;
  }
  return separator < 0
    ? { variant: '', base: value }
    : { variant: value.slice(0, separator + 1), base: value.slice(separator + 1) };
}

function textProperty(base: string): string[] {
  if (/^text-(?:left|center|right|justify|start|end)$/.test(base)) return ['text-align'];
  if (/^text-(?:xs|sm|base|lg|xl|[2-9]xl)(?:\/.*)?$/.test(base)) return ['font-size'];
  if (/^text-\[(?:length:)?-?(?:\d|\.)/.test(base) || /^text-\[length:/.test(base)) return ['font-size'];
  if (
    /^text-(?:white|black|transparent|current|inherit|\[(?:#|color:|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\()|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d)/.test(
      base
    )
  )
    return ['color'];
  return [];
}

function borderProperty(base: string): string[] {
  if (/^border-(?:solid|dashed|dotted|double|hidden|none)$/.test(base)) return ['border-style'];
  if (
    /^border(?:-[xytrbl])?(?:$|-(?:0|2|4|8|\[(?:length:)?-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh)?\]))$/.test(
      base
    )
  ) {
    const side = base.match(/^border-([xytrbl])(?:-|$)/)?.[1] ?? 'all';
    const sides: Readonly<Record<string, string[]>> = {
      all: ['top', 'right', 'bottom', 'left'],
      x: ['left', 'right'],
      y: ['top', 'bottom'],
      t: ['top'],
      r: ['right'],
      b: ['bottom'],
      l: ['left']
    };
    return (sides[side] ?? []).map((value) => `border-width-${value}`);
  }
  if (/^border-/.test(base)) return ['border-color'];
  return [];
}

function spacingProperties(base: string): string[] {
  const match = base.match(/^(-?)(p|m)([trblxy]?)-/);
  if (!match) return [];
  const kind = match[2] === 'p' ? 'padding' : 'margin';
  const axis = match[3] ?? '';
  const sides: Readonly<Record<string, string[]>> = {
    '': ['top', 'right', 'bottom', 'left'],
    x: ['left', 'right'],
    y: ['top', 'bottom'],
    t: ['top'],
    r: ['right'],
    b: ['bottom'],
    l: ['left']
  };
  return (sides[axis] ?? []).map((side) => `${kind}-${side}`);
}

function backgroundProperties(base: string): string[] {
  if (/^bg-(?:auto|cover|contain|\[length:)/.test(base)) return ['background-size'];
  if (/^bg-(?:bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|\[position:)/.test(base))
    return ['background-position'];
  if (/^bg-(?:repeat|repeat-x|repeat-y|repeat-round|repeat-space|no-repeat)$/.test(base)) return ['background-repeat'];
  if (/^bg-(?:fixed|local|scroll)$/.test(base)) return ['background-attachment'];
  if (/^bg-clip-/.test(base)) return ['background-clip'];
  if (/^bg-origin-/.test(base)) return ['background-origin'];
  if (
    /^bg-(?:none|gradient-to-|linear-|radial|conic|\[(?:url\(|image:|image-set\(|linear-gradient\(|radial-gradient\(|conic-gradient\())/.test(
      base
    )
  )
    return ['background-image'];
  // Cores nativas, arbitrárias e tokens configurados usam bg-* por padrão.
  return ['background-color'];
}

function insetProperties(base: string): string[] {
  if (/^-?inset-x-/.test(base)) return ['left', 'right'];
  if (/^-?inset-y-/.test(base)) return ['top', 'bottom'];
  if (/^-?inset-/.test(base)) return ['top', 'right', 'bottom', 'left'];
  const side = base.match(/^-?(top|right|bottom|left)-/)?.[1];
  return side ? [side] : [];
}

function radiusProperties(base: string): string[] {
  const scope = base.match(/^rounded(?:-([trbl]{1,2}))?(?:-|$)/)?.[1] ?? 'all';
  const corners: Readonly<Record<string, string[]>> = {
    all: ['top-left', 'top-right', 'bottom-right', 'bottom-left'],
    t: ['top-left', 'top-right'],
    r: ['top-right', 'bottom-right'],
    b: ['bottom-left', 'bottom-right'],
    l: ['top-left', 'bottom-left'],
    tl: ['top-left'],
    tr: ['top-right'],
    br: ['bottom-right'],
    bl: ['bottom-left']
  };
  return (corners[scope] ?? []).map((corner) => `border-radius-${corner}`);
}

function outlineProperties(base: string): string[] {
  if (/^outline-offset-/.test(base)) return ['outline-offset'];
  if (/^(?:outline|outline-(?:none|hidden|solid|dashed|dotted|double))$/.test(base)) return ['outline-style'];
  if (/^outline-(?:0|1|2|4|8|\[(?:length:)?-?(?:\d|\.)).*/.test(base)) return ['outline-width'];
  if (/^outline-/.test(base)) return ['outline-color'];
  return [];
}

function objectProperties(base: string): string[] {
  if (/^object-(?:contain|cover|fill|none|scale-down)$/.test(base)) return ['object-fit'];
  if (/^object-(?:bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|\[position:)/.test(base))
    return ['object-position'];
  return [];
}

function properties(baseValue: string): string[] {
  const base = baseValue.replace(/^!/, '');
  if (
    /^(?:block|inline|inline-block|inline-flex|inline-grid|flex|grid|hidden|contents|flow-root|table|table-row|table-cell)$/.test(
      base
    )
  )
    return ['display'];
  if (/^(?:static|fixed|absolute|relative|sticky)$/.test(base)) return ['position'];
  if (/^size-/.test(base)) return ['width', 'height'];
  if (/^w-/.test(base)) return ['width'];
  if (/^h-/.test(base)) return ['height'];
  if (/^min-w-/.test(base)) return ['min-width'];
  if (/^max-w-/.test(base)) return ['max-width'];
  if (/^min-h-/.test(base)) return ['min-height'];
  if (/^max-h-/.test(base)) return ['max-height'];
  if (/^aspect-/.test(base)) return ['aspect-ratio'];
  const spacing = spacingProperties(base);
  if (spacing.length) return spacing;
  if (/^gap-x-/.test(base)) return ['column-gap'];
  if (/^gap-y-/.test(base)) return ['row-gap'];
  if (/^gap-/.test(base)) return ['column-gap', 'row-gap'];
  if (/^flex-(?:row|row-reverse|col|col-reverse)$/.test(base)) return ['flex-direction'];
  if (/^flex-(?:wrap|wrap-reverse|nowrap)$/.test(base)) return ['flex-wrap'];
  if (/^flex-(?:1|auto|initial|none|\[)/.test(base)) return ['flex'];
  if (/^grow(?:-|$)/.test(base)) return ['flex-grow'];
  if (/^shrink(?:-|$)/.test(base)) return ['flex-shrink'];
  if (/^items-/.test(base)) return ['align-items'];
  if (/^justify-/.test(base)) return ['justify-content'];
  if (/^content-/.test(base)) return ['align-content'];
  if (/^self-/.test(base)) return ['align-self'];
  if (/^place-items-/.test(base)) return ['align-items', 'justify-items'];
  if (/^place-content-/.test(base)) return ['align-content', 'justify-content'];
  if (/^place-self-/.test(base)) return ['align-self', 'justify-self'];
  if (/^grid-cols-/.test(base)) return ['grid-template-columns'];
  if (/^grid-rows-/.test(base)) return ['grid-template-rows'];
  if (/^col-span-/.test(base)) return ['grid-column-span'];
  if (/^col-start-/.test(base)) return ['grid-column-start'];
  if (/^col-end-/.test(base)) return ['grid-column-end'];
  if (/^row-span-/.test(base)) return ['grid-row-span'];
  if (/^row-start-/.test(base)) return ['grid-row-start'];
  if (/^row-end-/.test(base)) return ['grid-row-end'];
  if (/^order-/.test(base)) return ['order'];
  if (/^bg-/.test(base)) return backgroundProperties(base);
  const text = textProperty(base);
  if (text.length) return text;
  if (/^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d{3}\])$/.test(base))
    return ['font-weight'];
  if (/^font-/.test(base)) return ['font-family'];
  if (/^leading-/.test(base)) return ['line-height'];
  if (/^tracking-/.test(base)) return ['letter-spacing'];
  if (/^rounded/.test(base)) return radiusProperties(base);
  const border = borderProperty(base);
  if (border.length) return border;
  const outline = outlineProperties(base);
  if (outline.length) return outline;
  if (/^opacity-/.test(base)) return ['opacity'];
  if (/^shadow/.test(base)) return ['box-shadow'];
  if (/^backdrop-blur/.test(base)) return ['backdrop-filter-blur'];
  if (/^blur/.test(base)) return ['filter-blur'];
  const object = objectProperties(base);
  if (object.length) return object;
  if (/^overflow-x-/.test(base)) return ['overflow-x'];
  if (/^overflow-y-/.test(base)) return ['overflow-y'];
  if (/^overflow-/.test(base)) return ['overflow-x', 'overflow-y'];
  const inset = insetProperties(base);
  if (inset.length) return inset;
  if (/^z-/.test(base)) return ['z-index'];
  if (/^(?:uppercase|lowercase|capitalize|normal-case)$/.test(base)) return ['text-transform'];
  if (/^(?:italic|not-italic)$/.test(base)) return ['font-style'];
  return [];
}

function parse(value: string): ParsedUtility {
  const { variant, base } = splitVariant(value);
  return { original: value, variant, base, properties: properties(base) };
}

export function optimizeTailwindClasses(values: readonly string[]): TailwindOptimizationResult {
  const issues: string[] = [];
  const conflicts: TailwindOptimizationResult['conflicts'] = [];
  const valid: ParsedUtility[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const validation = validateTailwindUtility(value);
    if (!validation.syntaxValid) {
      issues.push(`Classe inválida descartada: ${value}`);
      continue;
    }
    if (seen.has(value)) {
      issues.push(`Classe duplicada descartada: ${value}`);
      continue;
    }
    seen.add(value);
    valid.push(parse(value));
  }
  const covered = new Map<string, string>();
  const kept: ParsedUtility[] = [];
  for (let index = valid.length - 1; index >= 0; index -= 1) {
    const utility = valid[index]!;
    const keys = utility.properties.map((property) => `${utility.variant}|${property}`);
    const covering = keys.map((key) => covered.get(key)).filter((value): value is string => !!value);
    if (keys.length && covering.length === keys.length) {
      conflicts.push({ removed: utility.original, kept: covering[0]!, properties: utility.properties });
      issues.push(`Classe conflitante removida: ${utility.original}; prevaleceu ${covering[0]}.`);
      continue;
    }
    kept.push(utility);
    for (const key of keys) if (!covered.has(key)) covered.set(key, utility.original);
  }
  kept.reverse();
  const redundantMaxWidth = new Set(
    kept.filter((item) => item.base === 'w-full').map((item) => `${item.variant}max-w-full`)
  );
  const classes = kept
    .map((item) => item.original)
    .filter((value) => {
      if (!redundantMaxWidth.has(value)) return true;
      issues.push(`Classe redundante removida: ${value} junto de w-full no mesmo breakpoint.`);
      return false;
    });
  return { classes, issues, conflicts };
}
