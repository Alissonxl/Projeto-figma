import { describe, expect, it } from 'vitest';
import { isTabActivationKey, nextTabIndex } from '../src/ui/accessibility';
import { componentGenerationState } from '../src/ui/componentAvailability';
import { escapeHtml, safeNodeId } from '../src/ui/safeHtml';

describe('helpers de UI e acessibilidade', () => {
  it('implementa setas, Home e End no tablist', () => {
    expect(nextTabIndex(0, 'ArrowRight', 2)).toBe(1);
    expect(nextTabIndex(1, 'ArrowRight', 2)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 2)).toBe(1);
    expect(nextTabIndex(1, 'Home', 2)).toBe(0);
    expect(nextTabIndex(0, 'End', 2)).toBe(1);
  });
  it('ignora teclas não relacionadas e listas vazias', () => {
    expect(nextTabIndex(0, 'Enter', 2)).toBeNull();
    expect(nextTabIndex(0, 'Home', 0)).toBeNull();
  });
  it('ativa tabs com Enter, Espaço e Spacebar legado', () => {
    expect(isTabActivationKey('Enter')).toBe(true);
    expect(isTabActivationKey(' ')).toBe(true);
    expect(isTabActivationKey('Spacebar')).toBe(true);
    expect(isTabActivationKey('Escape')).toBe(false);
  });
  it('escapa payloads XSS e limita IDs usados em atributos', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml('"></button><script>alert(1)</script>')).not.toContain('<script>');
    expect(safeNodeId('x'.repeat(600))).toHaveLength(512);
  });

  it('libera JSX para Frame sem filhos assim que seus detalhes estão carregados', () => {
    expect(componentGenerationState([{ detailsLoaded: true }])).toBe('ready');
    expect(componentGenerationState([{ detailsLoaded: false }])).toBe('loading');
    expect(componentGenerationState([{}])).toBe('loading');
    expect(componentGenerationState([])).toBe('empty');
  });
});
