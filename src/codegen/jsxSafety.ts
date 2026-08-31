export function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

export function classAttribute(classes: readonly string[]): string {
  if (!classes.length) return '';
  const value = classes.join(' ');
  return value.includes('"') ? ` className={${JSON.stringify(value)}}` : ` className="${value}"`;
}

export function stringAttribute(name: string, value: string): string {
  return /["&<>{}\r\n]/.test(value) ? ` ${name}={${JSON.stringify(value)}}` : ` ${name}="${value}"`;
}

export function safeHyperlinkHref(value: string): string | null {
  const href = value.trim();
  if (!href || href.length > 2_048 || /[\u0000-\u001f\u007f\s]/.test(href)) return null;
  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) return null;
  return href;
}
