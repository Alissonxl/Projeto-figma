import type { ComponentCandidate, SmartNode } from '../types';
import { clampConfidence } from './confidenceEngine';
import { flattenSmartNodes } from './structuralSignature';

export interface ComponentDetectorOptions {
  minimumOccurrences: number;
  minimumConfidence: number;
  maxCandidates: number;
}

export const COMPONENT_DETECTOR_DEFAULTS: Readonly<ComponentDetectorOptions> = {
  minimumOccurrences: 2,
  minimumConfidence: 0.72,
  maxCandidates: 100
};

const GENERIC = /^(?:frame|group|rectangle|component|instance|section|layer)(?:\s|[-_]?\d|$)/i;

function pascalCase(value: string): string {
  const words =
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .match(/[A-Za-z0-9]+/g) ?? [];
  const result = words
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join('')
    .slice(0, 60);
  return result && !/^\d/.test(result) ? result : result ? `Figma${result}` : '';
}

function candidateName(nodes: readonly SmartNode[]): string {
  const named = nodes.find((node) => !GENERIC.test(node.name.trim()) && node.name.trim().length >= 2);
  const explicit = named ? pascalCase(named.name) : '';
  if (explicit) return explicit;
  const type = nodes.find((node) => node.semanticType !== 'unknown')?.semanticType ?? 'component';
  return `${type[0]!.toUpperCase()}${type.slice(1)}`;
}

export function detectComponents(
  roots: readonly SmartNode[],
  options: Partial<ComponentDetectorOptions> = {}
): ComponentCandidate[] {
  const settings = { ...COMPONENT_DETECTOR_DEFAULTS, ...options };
  const groups = new Map<string, SmartNode[]>();
  for (const node of flattenSmartNodes(roots)) {
    if (!node.children.length || node.semanticType === 'unknown') continue;
    const items = groups.get(node.structuralSignature) ?? [];
    items.push(node);
    groups.set(node.structuralSignature, items);
  }
  const result: ComponentCandidate[] = [];
  for (const [signature, nodes] of groups) {
    if (nodes.length < settings.minimumOccurrences) continue;
    const semanticCounts = new Map<string, number>();
    for (const node of nodes) semanticCounts.set(node.semanticType, (semanticCounts.get(node.semanticType) ?? 0) + 1);
    const semanticType = [...semanticCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] as
      SmartNode['semanticType'] | undefined;
    if (!semanticType) continue;
    const semanticAgreement = (semanticCounts.get(semanticType) ?? 0) / nodes.length;
    const meanConfidence = nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length;
    const confidence = clampConfidence(
      meanConfidence * 0.55 + semanticAgreement * 0.3 + Math.min(1, nodes.length / 4) * 0.15
    );
    if (confidence < settings.minimumConfidence) continue;
    result.push({
      signature,
      nodeIds: nodes.map((node) => node.id),
      nodeNames: nodes.map((node) => node.name),
      semanticType,
      componentName: candidateName(nodes),
      confidence
    });
  }
  return result
    .sort((left, right) => right.confidence - left.confidence || right.nodeIds.length - left.nodeIds.length)
    .slice(0, settings.maxCandidates);
}

export function applyComponentCandidates(roots: readonly SmartNode[], candidates: readonly ComponentCandidate[]): void {
  const byNode = new Map<string, ComponentCandidate>();
  for (const candidate of candidates) for (const id of candidate.nodeIds) byNode.set(id, candidate);
  for (const node of flattenSmartNodes(roots)) {
    const candidate = byNode.get(node.id);
    if (!candidate) continue;
    node.reusable = true;
    node.componentName = candidate.componentName;
  }
}
