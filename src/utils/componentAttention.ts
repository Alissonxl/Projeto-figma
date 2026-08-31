export type ComponentAttention = 'ready' | 'setup' | 'semantic' | 'review';

const ATTENTION_RANK: Readonly<Record<ComponentAttention, number>> = {
  ready: 0,
  setup: 1,
  semantic: 2,
  review: 3
};

export function mergeComponentAttention(...values: readonly ComponentAttention[]): ComponentAttention {
  return values.reduce<ComponentAttention>(
    (highest, value) => (ATTENTION_RANK[value] > ATTENTION_RANK[highest] ? value : highest),
    'ready'
  );
}

export function componentNeedsReview(attention: ComponentAttention): boolean {
  return attention === 'review';
}

export function componentAttentionLabel(attention: ComponentAttention): string {
  if (attention === 'review') return 'revisar fidelidade';
  if (attention === 'semantic') return 'confirmar semântica';
  if (attention === 'setup') return 'configurar projeto';
  return 'pronto';
}
