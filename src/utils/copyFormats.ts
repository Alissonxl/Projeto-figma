export type CopyFormat = 'classes' | 'react' | 'html' | 'vue';

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeTemplateLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export function formatCopyValue(classes: string, format: CopyFormat): string {
  if (!classes || format === 'classes') return classes;
  if (format === 'react') return `className="${escapeAttribute(classes)}"`;
  if (format === 'html') return `class="${escapeAttribute(classes)}"`;
  return `:class="\`${escapeAttribute(escapeTemplateLiteral(classes))}\`"`;
}
