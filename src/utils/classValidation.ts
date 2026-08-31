export interface ClassValidationResult {
  classes: string[];
  issues: string[];
}

export interface TailwindValidation {
  syntaxValid: boolean;
  knownUtility: boolean;
  warning?: string;
}

const INVALID_SERIALIZED_VALUE =
  /(?:^|[-:[(,/_])(?:undefined|null|[+-]?(?:NaN|Infinity)(?:px|rem|em|%|vh|vw|vmin|vmax)?)(?=$|[\]),}/:;_-])/;

export function isValidTailwindClass(value: string): boolean {
  if (!value || /\s/.test(value) || INVALID_SERIALIZED_VALUE.test(value)) return false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function baseUtility(value: string): string {
  let depth = 0;
  let lastSeparator = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[' || character === '(') depth += 1;
    else if (character === ']' || character === ')') depth = Math.max(0, depth - 1);
    else if (character === ':' && depth === 0) lastSeparator = index;
  }
  return value.slice(lastSeparator + 1).replace(/^!/, '');
}

const KNOWN_UTILITY_PATTERNS: readonly RegExp[] = [
  /^(?:block|inline|inline-block|inline-flex|inline-grid|flex|grid|hidden|contents|flow-root|table|table-row|table-cell)$/,
  /^(?:static|fixed|absolute|relative|sticky)$/,
  /^overflow(?:-[xy])?-(?:auto|hidden|clip|visible|scroll)$/,
  /^(?:truncate|container|isolate|sr-only|not-sr-only)$/,
  /^line-clamp-.+$/,
  /^(?:size|w|h|min-w|max-w|min-h|max-h|inset|inset-x|inset-y|top|right|bottom|left|z)-.+$/,
  /^(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|space-x|space-y|gap|gap-x|gap-y)-.+$/,
  /^flex-(?:row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none)$/,
  /^(?:grow|shrink)(?:-0)?$/,
  /^(?:grid-cols|grid-rows)-.+$/,
  /^(?:col|row)-(?:auto|span-.+|start-.+|end-.+)$/,
  /^(?:items|justify|content|self|order)-.+$/,
  /^place-(?:items|content|self)-.+$/,
  /^(?:aspect|object|bg|text|font|leading|tracking)-.+$/,
  /^(?:italic|not-italic|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case)$/,
  /^(?:border|outline|ring|rounded)(?:-.+)?$/,
  /^(?:shadow|blur)(?:-.+)?$/,
  /^(?:opacity|backdrop|mix-blend|fill|stroke|cursor|select|pointer-events|whitespace|break|list)-.+$/
];

function isKnownUtility(value: string): boolean {
  const base = baseUtility(value);
  if (/^\[[a-z-]+:.+\]$/i.test(base)) return true;
  if (/^-?[a-z][a-z0-9-]*-\[.+\]$/i.test(base)) return true;
  return KNOWN_UTILITY_PATTERNS.some((pattern) => pattern.test(base));
}

export function validateTailwindUtility(value: string): TailwindValidation {
  if (!isValidTailwindClass(value))
    return { syntaxValid: false, knownUtility: false, warning: 'Classe Tailwind sintaticamente inválida.' };
  if (isKnownUtility(value)) return { syntaxValid: true, knownUtility: true };
  return {
    syntaxValid: true,
    knownUtility: false,
    warning:
      'Sintaxe válida, mas a utility não pertence ao conjunto nativo reconhecido; pode vir de plugin ou configuração customizada.'
  };
}

export function validateClassList(values: readonly string[]): ClassValidationResult {
  const classes: string[] = [],
    issues: string[] = [],
    seen = new Set<string>();
  for (const value of values) {
    if (!isValidTailwindClass(value)) {
      issues.push(`Classe inválida descartada: ${value}`);
      continue;
    }
    if (seen.has(value)) {
      issues.push(`Classe duplicada descartada: ${value}`);
      continue;
    }
    seen.add(value);
    classes.push(value);
  }
  return { classes, issues };
}
