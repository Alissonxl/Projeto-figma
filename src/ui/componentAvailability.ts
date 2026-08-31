import type { ParsedNode } from '../types';

export type ComponentGenerationState = 'empty' | 'loading' | 'ready';

/**
 * JSX can be generated for any fully parsed node, including leaf Frames.
 * Children improve the generated structure, but are not a prerequisite for code generation.
 */
export function componentGenerationState(
  nodes: readonly Pick<ParsedNode, 'detailsLoaded'>[]
): ComponentGenerationState {
  if (nodes.length === 0) return 'empty';
  return nodes.every((node) => node.detailsLoaded === true) ? 'ready' : 'loading';
}
