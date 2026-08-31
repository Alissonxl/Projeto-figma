import { Script } from 'node:vm';

const CSS_PLACEHOLDER = '/*__CSS__*/';
const JS_PLACEHOLDER = '/*__JS__*/';

function replacePlaceholder(template, placeholder, value) {
  if (!template.includes(placeholder)) throw new Error(`Placeholder ausente no template: ${placeholder}`);
  // A função de substituição é intencional: uma replacement string interpreta $&, $` e $'.
  return template.replace(placeholder, () => value);
}

export function extractInlineUiScript(html) {
  const opening = '<script>';
  const start = html.indexOf(opening);
  const end = html.lastIndexOf('</script>');
  if (start < 0 || end <= start) throw new Error('Script da UI não encontrado no HTML compilado.');
  return html.slice(start + opening.length, end).trim();
}

export function assertValidInlineUiScript(html) {
  new Script(extractInlineUiScript(html), { filename: 'dist/ui.html' });
}

export function embedUiHtml(template, css, javascript) {
  // Evita que uma string do bundle encerre prematuramente o elemento <script>.
  const safeJavascript = javascript.replace(/<\/script/giu, '<\\/script');
  const withCss = replacePlaceholder(template, CSS_PLACEHOLDER, css);
  const html = replacePlaceholder(withCss, JS_PLACEHOLDER, safeJavascript);
  assertValidInlineUiScript(html);
  return html;
}
