import type { ComponentCandidate, ParsedNode, VariantDifference, VariantGroup } from '../types';
import { clampConfidence } from './confidenceEngine';

const DOMAINS: ReadonlyArray<readonly [string, RegExp]> = [
  ['background', /^bg-/],
  ['border', /^(?:border|outline|ring)(?:-|$)/],
  [
    'text-color',
    /^text-(?:white|black|transparent|current|inherit|\[#|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d)/
  ],
  ['opacity', /^opacity-/],
  ['radius', /^rounded/],
  ['padding', /^p[trblxy]?-/],
  ['icon', /^(?:fill|stroke)-/]
];

function flatten(nodes: readonly ParsedNode[]): Map<string, ParsedNode> {
  const result = new Map<string, ParsedNode>();
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop()!;
    result.set(node.id, node);
    stack.push(...node.children);
  }
  return result;
}

function domainValues(node: ParsedNode, pattern: RegExp): string {
  const values: string[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    values.push(...current.classes.filter((value) => pattern.test(value)));
    stack.push(...current.children);
  }
  return [...new Set(values)].sort().join(' ');
}

function inferredVariantName(name: string, index: number): string {
  const normalized = name.toLowerCase();
  const known = ['primary', 'secondary', 'outline', 'ghost', 'destructive', 'danger', 'disabled', 'hover', 'active'];
  const match = known.find((value) => normalized.includes(value));
  return match ?? `variant-${index + 1}`;
}

export function detectVariants(
  roots: readonly ParsedNode[],
  components: readonly ComponentCandidate[]
): VariantGroup[] {
  const byId = flatten(roots);
  const result: VariantGroup[] = [];
  for (const component of components) {
    const nodes = component.nodeIds.map((id) => byId.get(id)).filter((node): node is ParsedNode => !!node);
    if (nodes.length < 2) continue;
    const differences: VariantDifference[] = [];
    for (const [property, pattern] of DOMAINS) {
      const values = nodes.map((node) => domainValues(node, pattern));
      if (new Set(values).size > 1) differences.push({ property, values });
    }
    if (!differences.length || differences.length > 5) continue;
    const names = nodes.map((node, index) => inferredVariantName(node.name, index));
    const meaningfulNames = new Set(names).size === names.length && names.some((name) => !name.startsWith('variant-'));
    const confidence = clampConfidence(
      component.confidence * 0.75 + (meaningfulNames ? 0.15 : 0.05) + 0.1 / differences.length
    );
    if (confidence < 0.7) continue;
    result.push({
      componentName: component.componentName,
      nodeIds: nodes.map((node) => node.id),
      variantNames: names,
      differences,
      confidence
    });
  }
  return result;
}
