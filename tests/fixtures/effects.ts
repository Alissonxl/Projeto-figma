export const dropShadow = (overrides: Record<string, unknown> = {}): DropShadowEffect => ({
  type: 'DROP_SHADOW',
  offset: { x: 0, y: 1 },
  radius: 2,
  spread: 0,
  color: { r: 0, g: 0, b: 0, a: 0.05 },
  visible: true,
  blendMode: 'NORMAL',
  showShadowBehindNode: false,
  ...overrides
});

export const progressiveBlur = (overrides: Record<string, unknown> = {}): BlurEffect => ({
  type: 'LAYER_BLUR',
  blurType: 'PROGRESSIVE',
  radius: 24,
  startRadius: 2,
  startOffset: { x: 0, y: 0 },
  endOffset: { x: 1, y: 1 },
  visible: true,
  ...overrides
});
