import type { ComponentCandidate, ParsedNode, RepetitionPattern } from '../types';
import { clampConfidence } from './confidenceEngine';

export interface RepetitionDetectorOptions {
  minimumOccurrences: number;
  maximumPatterns: number;
}

export const REPETITION_DEFAULTS: Readonly<RepetitionDetectorOptions> = {
  minimumOccurrences: 3,
  maximumPatterns: 50
};

function flattenParsed(nodes: readonly ParsedNode[]): Map<string, ParsedNode> {
  const result = new Map<string, ParsedNode>();
  const stack = [...nodes];
  while (stack.length) {
    const node = stack.pop()!;
    result.set(node.id, node);
    stack.push(...node.children);
  }
  return result;
}

function textValues(node: ParsedNode): string[] {
  const result: string[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    const value = current.codegen?.text?.trim();
    if (current.type === 'TEXT' && value) result.push(value);
    stack.push(...current.children);
  }
  return result;
}

function imageValues(node: ParsedNode): string[] {
  const result: string[] = [];
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.codegen?.imageScaleMode) result.push(current.name);
    stack.push(...current.children);
  }
  return result;
}

export function detectRepetitions(
  roots: readonly ParsedNode[],
  components: readonly ComponentCandidate[],
  options: Partial<RepetitionDetectorOptions> = {}
): RepetitionPattern[] {
  const settings = { ...REPETITION_DEFAULTS, ...options };
  const byId = flattenParsed(roots);
  const result: RepetitionPattern[] = [];
  for (const component of components) {
    if (component.nodeIds.length < settings.minimumOccurrences) continue;
    const nodes = component.nodeIds.map((id) => byId.get(id)).filter((node): node is ParsedNode => !!node);
    if (nodes.length < settings.minimumOccurrences) continue;
    const textFingerprints = nodes.map((node) => textValues(node).join('\u241f'));
    const imageFingerprints = nodes.map((node) => imageValues(node).join('\u241f'));
    const propCandidates: string[] = [];
    if (new Set(textFingerprints).size > 1) propCandidates.push('content');
    if (new Set(imageFingerprints).size > 1) propCandidates.push('image');
    const useDataMap = propCandidates.length > 0;
    const variationEvidence = useDataMap ? 1 : 0.65;
    result.push({
      signature: component.signature,
      nodeIds: nodes.map((node) => node.id),
      componentName: component.componentName,
      count: nodes.length,
      useDataMap,
      propCandidates,
      confidence: clampConfidence(
        component.confidence * 0.7 + Math.min(1, nodes.length / 5) * 0.2 + variationEvidence * 0.1
      )
    });
  }
  return result
    .sort((left, right) => right.count - left.count || right.confidence - left.confidence)
    .slice(0, settings.maximumPatterns);
}
