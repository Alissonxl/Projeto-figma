import { describe, expect, it } from 'vitest';
import { effects } from '../src/converters/effects';
import { DEFAULT_SETTINGS } from '../src/types';
import { dropShadow, progressiveBlur } from './fixtures/effects';

describe('efeitos avançados', () => {
  it('não converte Progressive Blur como blur uniforme', () => {
    const result = effects({ effects: [progressiveBlur()] } as unknown as SceneNode, DEFAULT_SETTINGS);
    expect(result.converted).toEqual([]);
    expect(result.unsupported.join(' ')).toContain('progressivo');
  });

  it('não marca sombra com blend mode não suportado como exata', () => {
    const result = effects(
      { effects: [dropShadow({ blendMode: 'MULTIPLY' })] } as unknown as SceneNode,
      DEFAULT_SETTINGS
    );
    expect(result.converted).toEqual([]);
    expect(result.unsupported.join(' ')).toContain('MULTIPLY');
  });

  it('não converte showShadowBehindNode como box-shadow equivalente', () => {
    const result = effects(
      { effects: [dropShadow({ showShadowBehindNode: true })] } as unknown as SceneNode,
      DEFAULT_SETTINGS
    );
    expect(result.converted).toEqual([]);
    expect(result.unsupported.join(' ')).toContain('showShadowBehindNode');
  });

  it('converte showShadowBehindNode quando um fill sólido opaco esconde completamente a diferença', () => {
    const result = effects(
      {
        type: 'RECTANGLE',
        opacity: 1,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1, visible: true }],
        effects: [
          dropShadow({
            offset: { x: 0, y: 10 },
            radius: 30,
            color: { r: 16 / 255, g: 51 / 255, b: 30 / 255, a: 0.1 },
            showShadowBehindNode: true
          })
        ]
      } as unknown as SceneNode,
      DEFAULT_SETTINGS
    );
    expect(result.unsupported).toEqual([]);
    expect(result.converted[0]?.classes[0]).toBe('shadow-[0_10px_30px_0_#10331E1A]');
  });
});
