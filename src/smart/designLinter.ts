import type { ComponentCandidate, DesignLintIssue, ParsedNode } from '../types';

interface Fact {
  property: DesignLintIssue['category'];
  value: string;
}

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

function facts(node: ParsedNode): Fact[] {
  const result: Fact[] = [];
  for (const conversion of node.conversions) {
    if (conversion.category === 'spacing' && conversion.property.startsWith('padding'))
      result.push({ property: 'spacing', value: `${conversion.property}:${conversion.value}` });
    if (conversion.category === 'border' && conversion.property.includes('radius'))
      result.push({ property: 'radius', value: conversion.value });
    if (conversion.category === 'background' && conversion.property.includes('color'))
      result.push({ property: 'color', value: conversion.value });
    if (conversion.category === 'typography' && /font (?:size|weight|family)/.test(conversion.property))
      result.push({ property: 'typography', value: `${conversion.property}:${conversion.value}` });
  }
  if (node.codegen) result.push({ property: 'size', value: `${node.codegen.width}×${node.codegen.height}` });
  if (node.children.length >= 2 && node.children.every((child) => child.codegen))
    result.push({
      property: 'alignment',
      value: node.children.map((child) => `${child.type}:${Math.round(child.codegen!.x * 2) / 2}`).join('|')
    });
  return result;
}

function color(value: string): [number, number, number] | null {
  const match = value.match(/^#([0-9A-F]{6})(?:[0-9A-F]{2})?$/i)?.[1];
  return match
    ? ([0, 2, 4].map((index) => Number.parseInt(match.slice(index, index + 2), 16)) as [number, number, number])
    : null;
}

function nearColorPairs(nodes: readonly ParsedNode[]): DesignLintIssue[] {
  const values = nodes
    .map((node) => ({
      node,
      value: node.conversions.find(
        (conversion) =>
          ['background', 'typography', 'border'].includes(conversion.category) &&
          /color/.test(conversion.property) &&
          color(conversion.value)
      )?.value
    }))
    .filter((item): item is { node: ParsedNode; value: string } => !!item.value);
  const issues: DesignLintIssue[] = [];
  const seen = new Set<string>();
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    const left = values[leftIndex]!;
    const leftColor = color(left.value)!;
    for (let rightIndex = leftIndex + 1; rightIndex < values.length; rightIndex += 1) {
      const right = values[rightIndex]!;
      if (left.value.toUpperCase() === right.value.toUpperCase()) continue;
      const rightColor = color(right.value)!;
      const distance = Math.hypot(
        leftColor[0] - rightColor[0],
        leftColor[1] - rightColor[1],
        leftColor[2] - rightColor[2]
      );
      if (distance > 6) continue;
      const key = [left.value.toUpperCase(), right.value.toUpperCase()].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        severity: 'info',
        category: 'color',
        nodeIds: [left.node.id, right.node.id],
        message: `Cores quase idênticas (${left.value} e ${right.value}) aparecem em componentes equivalentes; confirme se deveriam usar o mesmo token.`,
        expected: left.value,
        actual: right.value
      });
    }
  }
  return issues;
}

function dominant(values: readonly string[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top ? { value: top[0], count: top[1] } : null;
}

export function lintDesign(roots: readonly ParsedNode[], components: readonly ComponentCandidate[]): DesignLintIssue[] {
  const byId = flatten(roots);
  const issues: DesignLintIssue[] = [];
  for (const component of components) {
    if (component.nodeIds.length < 3) continue;
    const nodes = component.nodeIds.map((id) => byId.get(id)).filter((node): node is ParsedNode => !!node);
    for (const category of ['spacing', 'radius', 'color', 'typography', 'alignment', 'size'] as const) {
      const valuesByNode = nodes.map((node) => ({
        id: node.id,
        values: facts(node)
          .filter((fact) => fact.property === category)
          .map((fact) => fact.value)
          .sort()
          .join('|')
      }));
      const nonEmpty = valuesByNode.filter((item) => item.values);
      const expected = dominant(nonEmpty.map((item) => item.values));
      if (!expected || expected.count < 2 || expected.count === nonEmpty.length) continue;
      for (const outlier of nonEmpty.filter((item) => item.values !== expected.value))
        issues.push({
          severity: 'warning',
          category,
          nodeIds: [outlier.id],
          message: `${component.componentName}: possível inconsistência de ${category}; componentes semelhantes usam valores diferentes.`,
          expected: expected.value,
          actual: outlier.values
        });
    }
    issues.push(...nearColorPairs(nodes));
  }
  return issues.slice(0, 200);
}
