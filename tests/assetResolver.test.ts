import { describe, expect, it } from 'vitest';
import { assetName, inferredImageAlt } from '../src/codegen/assetResolver';

describe('resolução segura de assets', () => {
  it('gera nomes determinísticos, limitados e sem caracteres executáveis', () => {
    expect(assetName('Imagem da Seção / Verão')).toBe('imagem-da-secao-verao');
    expect(assetName('<script>alert(1)</script>')).toBe('script-alert-1-script');
    expect(assetName('a'.repeat(200))).toHaveLength(80);
    expect(assetName('***')).toBe('figma-image');
  });

  it('não inventa alt para nomes genéricos', () => {
    expect(inferredImageAlt({ name: 'Rectangle 250' })).toBeNull();
    expect(inferredImageAlt({ name: 'Image 12' })).toBeNull();
    expect(inferredImageAlt({ name: 'Equipe trabalhando no jardim' })).toBe('Equipe trabalhando no jardim');
  });
});
