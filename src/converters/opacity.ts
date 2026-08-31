import type { Conversion } from '../types';
export function opacity(value: number): Conversion | null {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    return {
      category: 'misc',
      property: 'opacity',
      value: 'invalid',
      classes: [],
      fidelity: 'unsupported',
      note: 'Opacidade fora da faixa de 0 a 1; nenhuma classe foi gerada.'
    };
  if (value === 1) return null;
  const percentValue = value * 100;
  const percent = Math.round(percentValue);
  const standardValues = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  const standard = standardValues.includes(percent) && Math.abs(percentValue - percent) < 0.000001;
  const displayPercent = Number(percentValue.toFixed(4));
  const arbitraryValue = Number(value.toFixed(6));
  return {
    category: 'misc',
    property: 'opacity',
    value: `${displayPercent}%`,
    classes: [standard ? `opacity-${percent}` : `opacity-[${arbitraryValue}]`],
    fidelity: standard ? 'exact' : 'arbitrary'
  };
}
