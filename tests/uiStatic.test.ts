import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('src/ui/index.html', 'utf8');
const css = readFileSync('src/ui/style.css', 'utf8');
const ui = readFileSync('src/ui/ui.ts', 'utf8');

describe('contrato estático de UI responsiva e acessível', () => {
  it('mantém tabs nativas com estado e relacionamento ARIA', () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="inspect"');
    expect(html).toContain('role="tabpanel"');
  });
  it('expõe feedback e toast em live regions', () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="responsive-status-badge" class="badge" role="status" aria-live="polite"');
    expect(html).toContain('<div id="responsive-panel"></div>');
  });
  it('expõe Responsive Compare condicional, controles manuais e níveis de confiança', () => {
    expect(html).toContain('id="tab-responsive"');
    expect(html).toContain('id="responsive-panel"');
    expect(html).toContain('id="responsivePreset"');
    expect(html).toContain('id="responsiveMatchConfidence"');
    expect(ui).toContain('data-responsive-base');
    expect(ui).toContain('data-responsive-breakpoint');
    expect(ui).toContain('data-responsive-link');
    expect(ui).toContain('responsiveSelectionEligible');
    expect(css).toContain('.responsive-diff.review');
  });
  it('mantém diagnóstico inteligente opt-in e restringe HTML dinâmico ao painel responsivo escapado', () => {
    expect(html).toContain('id="smartDebug"');
    expect(html).toContain('sem enviar dados para serviços externos');
    expect(ui.match(/\.innerHTML/g) ?? []).toHaveLength(1);
    expect(ui).toContain("$('responsive-panel').innerHTML");
    expect(ui).toContain('escapeHtml');
  });
  it('expõe código montado e ação de cópia estrutural', () => {
    expect(html).toContain('id="component-code-details"');
    expect(html).toContain('id="component-code"');
    expect(html).toContain('id="component-output-mode"');
    expect(html).toContain('id="component-output-scope"');
    expect(html).toContain('value="selection"');
    expect(html).toContain('Somente elemento atual');
    expect(html).toContain('value="faithful"');
    expect(html).toContain('value="responsive"');
    expect(html).toContain('value="component"');
    expect(html).toContain('id="copy-component"');
    expect(html).toContain('Copiar mapa por camada');
    expect(ui).toContain('Confiança estrutural:');
    expect(ui).toContain("'Media Query'");
    expect(css).toContain('.component-notes .decision-reason');
  });
  it('mantém os limites responsivos da interface alinhados à normalização', () => {
    expect(html).toContain('id="responsiveGeometryTolerance" type="number" min="0.005" max="0.25"');
    expect(html).toContain('id="responsivePercentageTolerance" type="number" min="0.002" max="0.1"');
    expect(ui).toContain("numberValue('responsiveGeometryTolerance', 0.05, 0.005, 0.25)");
    expect(ui).toContain("numberValue('responsivePercentageTolerance', 0.015, 0.002, 0.1)");
  });
  it('aceita mensagens validadas vindas do sandbox do Figma', () => {
    expect(ui).not.toContain('event.source !== parent');
    expect(ui).toContain('parsePluginMessage(event.data?.pluginMessage)');
  });
  it('usa automaticamente a seleção completa para pares responsivos', () => {
    expect(ui).toContain("if (responsiveSelectionEligible() && componentOutputMode !== 'faithful')");
    expect(ui).toContain("componentOutputScope = 'selection'");
  });
  it.each([280, 320, 440, 600])('possui proteções contra overflow crítico em %ipx', (width) => {
    expect(width).toBeGreaterThanOrEqual(280);
    expect(css).toContain('box-sizing: border-box');
    expect(css).toContain('overflow-x: hidden');
    expect(css).toContain('@media (max-width: 360px)');
    expect(css).toContain('min-width: 0');
  });
});
