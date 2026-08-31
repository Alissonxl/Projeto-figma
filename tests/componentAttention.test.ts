import { describe, expect, it } from 'vitest';
import {
  componentAttentionLabel,
  componentNeedsReview,
  mergeComponentAttention
} from '../src/utils/componentAttention';

describe('component attention policy', () => {
  it('mantém setup e semântica separados de falhas de fidelidade', () => {
    expect(componentNeedsReview('setup')).toBe(false);
    expect(componentNeedsReview('semantic')).toBe(false);
    expect(componentNeedsReview('review')).toBe(true);
    expect(mergeComponentAttention('setup', 'semantic')).toBe('semantic');
    expect(mergeComponentAttention('semantic', 'review', 'setup')).toBe('review');
  });

  it('expõe rótulos específicos em vez de um revisar genérico', () => {
    expect(componentAttentionLabel('ready')).toBe('pronto');
    expect(componentAttentionLabel('setup')).toBe('configurar projeto');
    expect(componentAttentionLabel('semantic')).toBe('confirmar semântica');
    expect(componentAttentionLabel('review')).toBe('revisar fidelidade');
  });
});
