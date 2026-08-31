import type { AccessibilityIssue, ParsedNode, SmartNode } from '../types';

const GENERIC_IMAGE = /^(?:image|img|photo|foto|rectangle|frame|group|asset)(?:\s|[-_]?\d|$)/i;

function meaningfulText(node: ParsedNode): boolean {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.type === 'TEXT' && /\p{L}|\p{N}/u.test(current.codegen?.text ?? '')) return true;
    stack.push(...current.children);
  }
  return false;
}

function hasExplicitLabel(node: ParsedNode): boolean {
  const stack = [...node.children];
  while (stack.length) {
    const current = stack.pop()!;
    if (
      current.type === 'TEXT' &&
      /(?:^|[\s_/-])label(?:$|[\s_/-])|r[oó]tulo/i.test(current.name) &&
      meaningfulText(current)
    )
      return true;
    stack.push(...current.children);
  }
  return false;
}

function explicitHeadingLevel(node: ParsedNode): number | null {
  if (node.type !== 'TEXT') return null;
  const normalized = node.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const explicit =
    normalized.match(/(?:^|[^a-z0-9])h([1-6])(?:[^a-z0-9]|$)/)?.[1] ??
    normalized.match(/heading[\s_/-]*([1-6])(?:[^0-9]|$)/)?.[1];
  return explicit ? Number(explicit) : null;
}

function hex(value: string | undefined): [number, number, number] | null {
  const match = value?.match(/^#([0-9A-F]{6})$/i)?.[1];
  if (!match) return null;
  return [0, 2, 4].map((index) => parseInt(match.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(color: [number, number, number]): number {
  const channels = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(left: [number, number, number], right: [number, number, number]): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function analyzeAccessibility(
  parsedRoots: readonly ParsedNode[],
  smartRoots: readonly SmartNode[]
): AccessibilityIssue[] {
  const parsedById = new Map<string, ParsedNode>();
  const smartById = new Map<string, SmartNode>();
  const parsedStack = [...parsedRoots];
  const smartStack = [...smartRoots];
  while (parsedStack.length) {
    const node = parsedStack.pop()!;
    parsedById.set(node.id, node);
    parsedStack.push(...node.children);
  }
  while (smartStack.length) {
    const node = smartStack.pop()!;
    smartById.set(node.id, node);
    smartStack.push(...node.children);
  }
  const issues: AccessibilityIssue[] = [];
  const visit = (node: ParsedNode, parentBackground?: string): void => {
    const smart = smartById.get(node.id);
    const background = smart?.appearance.background ?? parentBackground;
    if (smart?.semanticType === 'image' && GENERIC_IMAGE.test(node.name.trim()))
      issues.push({
        severity: 'warning',
        rule: 'image-alt',
        nodeId: node.id,
        message: 'A imagem possui nome genérico; não é seguro inferir um texto alternativo.',
        autoFix: 'Use alt="" somente se a imagem for decorativa; caso contrário, descreva sua função.'
      });
    if (smart?.semanticType === 'button') {
      if (!meaningfulText(node))
        issues.push({
          severity: 'error',
          rule: 'button-name',
          nodeId: node.id,
          message: 'Botão sem nome acessível confirmado.',
          autoFix: 'Adicione texto visível ou aria-label revisado por uma pessoa.'
        });
      if (smart.layout.width < 44 || smart.layout.height < 44)
        issues.push({
          severity: 'warning',
          rule: 'target-size',
          nodeId: node.id,
          message: `Área clicável de ${smart.layout.width}×${smart.layout.height}px pode ser pequena para toque.`
        });
    }
    if (smart?.semanticType === 'input' && !hasExplicitLabel(node))
      issues.push({
        severity: 'warning',
        rule: 'input-label',
        nodeId: node.id,
        message: 'Campo sem label explícito verificável; placeholder ou texto interno não substitui label.',
        autoFix: 'Adicione um <label htmlFor="…"> associado ao id do campo.'
      });
    const hyperlink =
      node.codegen?.hyperlink ?? node.children.find((child) => child.codegen?.hyperlink)?.codegen?.hyperlink;
    if (hyperlink && (!smart || smart.semanticType === 'container' || smart.semanticType === 'unknown'))
      issues.push({
        severity: 'warning',
        rule: 'interactive-semantics',
        nodeId: node.id,
        message: 'Elemento clicável sem semântica interativa confiável; não gere uma div clicável automaticamente.'
      });
    if (node.type === 'TEXT') {
      const foreground = hex(smart?.appearance.textColor);
      const surface = hex(background);
      if (foreground && surface && contrast(foreground, surface) < 4.5)
        issues.push({
          severity: 'warning',
          rule: 'contrast',
          nodeId: node.id,
          message: 'Contraste potencialmente abaixo de 4.5:1 para texto normal; valide conforme tamanho e contexto.'
        });
    }
    for (const child of node.children) visit(child, background);
  };
  for (const root of parsedRoots) {
    visit(root);
    const headings: Array<{ node: ParsedNode; level: number }> = [];
    const stack = [root];
    while (stack.length) {
      const current = stack.pop()!;
      const level = explicitHeadingLevel(current);
      if (level !== null) headings.push({ node: current, level });
      stack.push(...[...current.children].reverse());
    }
    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1]!;
      const current = headings[index]!;
      if (current.level <= previous.level + 1) continue;
      issues.push({
        severity: 'warning',
        rule: 'heading-order',
        nodeId: current.node.id,
        message: `Hierarquia explícita salta de h${previous.level} para h${current.level}; confirme a estrutura da página.`
      });
    }
  }
  return issues.slice(0, 300);
}
