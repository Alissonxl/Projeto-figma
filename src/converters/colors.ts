import type { Conversion, Settings } from '../types';
import type { Rgba } from '../utils/colors';
import { colorClass, toHexWithAlpha } from '../utils/colors';

export function paintColor(
  kind: 'background' | 'text' | 'border' | 'outline',
  color: Rgba,
  settings: Settings
): Conversion {
  const prefix = kind === 'background' ? 'bg' : kind === 'text' ? 'text' : kind;
  const channels = [color.r, color.g, color.b, color.a ?? 1];
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1))
    return {
      category:
        kind === 'background' ? 'background' : kind === 'border' || kind === 'outline' ? 'border' : 'typography',
      property: `${kind} color`,
      value: 'invalid',
      classes: [],
      fidelity: 'unsupported',
      note: 'Cor com canal fora da faixa de 0 a 1; nenhuma classe foi gerada.'
    };
  const value = toHexWithAlpha(color);
  const className = colorClass(prefix, color, settings);
  return {
    category: kind === 'background' ? 'background' : kind === 'border' || kind === 'outline' ? 'border' : 'typography',
    property: `${kind} color`,
    value,
    classes: [className],
    source: { color: value },
    fidelity: className.includes('-[') ? 'arbitrary' : 'exact'
  };
}
