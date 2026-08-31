import { describe, expect, it } from 'vitest';
import { assertValidInlineUiScript, embedUiHtml, extractInlineUiScript } from '../scripts/embedUi.mjs';

describe('empacotamento da UI', () => {
  const template = '<style>/*__CSS__*/</style><script>/*__JS__*/</script>';

  it('não interpreta sequências especiais de String.replace presentes no bundle', () => {
    const javascript = String.raw`const endPattern = /foo$'/; const prefixPattern = /bar$\`/;`;
    const html = embedUiHtml(template, '.app{display:block}', javascript);

    expect(extractInlineUiScript(html)).toBe(javascript);
    expect(() => assertValidInlineUiScript(html)).not.toThrow();
    expect(html).not.toContain('<!doctype html>');
  });

  it('neutraliza fechamento de script contido em strings do bundle', () => {
    const html = embedUiHtml(template, '', 'const unsafe = "</script>";');

    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(() => assertValidInlineUiScript(html)).not.toThrow();
  });

  it('falha cedo se o template perder um placeholder obrigatório', () => {
    expect(() => embedUiHtml('<script>/*__JS__*/</script>', '', 'const ok = true;')).toThrow('Placeholder ausente');
  });
});
