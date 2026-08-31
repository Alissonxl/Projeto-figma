import { describe, expect, it } from 'vitest';
import { classAttribute, escapeJsxText, safeHyperlinkHref, stringAttribute } from '../src/codegen/jsxSafety';

describe('segurança do JSX gerado', () => {
  it('neutraliza texto vindo do Figma sem criar expressão JSX', () => {
    expect(escapeJsxText('<img onError={attack()}>{value}&')).toBe(
      '&lt;img onError=&#123;attack()&#125;&gt;&#123;value&#125;&amp;'
    );
  });

  it('serializa atributos e classes que contêm aspas', () => {
    expect(stringAttribute('aria-label', 'Fechar "modal"\nAgora')).toBe(' aria-label={"Fechar \\"modal\\"\\nAgora"}');
    expect(classAttribute(['font-["Inter"]', 'text-sm'])).toContain('className={');
  });

  it('bloqueia protocolos executáveis, controles e links grandes', () => {
    expect(safeHyperlinkHref('javascript:alert(1)')).toBeNull();
    expect(safeHyperlinkHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHyperlinkHref('https://example.com/a b')).toBeNull();
    expect(safeHyperlinkHref(`https://example.com/${'a'.repeat(2_100)}`)).toBeNull();
    expect(safeHyperlinkHref('/contato')).toBe('/contato');
    expect(safeHyperlinkHref('mailto:hello@example.com')).toBe('mailto:hello@example.com');
  });
});
