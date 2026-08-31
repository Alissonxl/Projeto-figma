import type { ParsedNode } from '../types';

export function componentName(node: ParsedNode): string {
  const generic = /^(?:group|frame|rectangle|component|instance)(?:\s|\d|$)/i.test(node.name.trim());
  if (generic) return 'Card';
  const words = node.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[A-Za-z0-9]+/g);
  const base =
    words
      ?.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
      .join('')
      .slice(0, 60) || 'Card';
  const safe = /^\d/.test(base) ? `Figma${base}` : base;
  return safe.endsWith('Card') ? safe : `${safe}Card`;
}

export function indentCode(value: string, spaces: number): string {
  const indentation = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${indentation}${line}`)
    .join('\n');
}

export function componentWithProps(node: ParsedNode, jsx: string, includeHref: boolean): string {
  const name = componentName(node);
  return `export interface ${name}Props {
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
${includeHref ? '  href: string;\n' : ''}}

export function ${name}({
  title,
  description,
  imageSrc,
  imageAlt,
${includeHref ? '  href,\n' : ''}}: ${name}Props) {
  return (
${indentCode(jsx, 4)}
  );
}`;
}
