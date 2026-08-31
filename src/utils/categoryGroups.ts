import type { Category, ClassGroup, Conversion, PanelCategory } from '../types';

const CATEGORY_MAP: Readonly<Record<Category, PanelCategory>> = {
  layout: 'layout',
  display: 'layout',
  flex: 'layout',
  grid: 'layout',
  dimensions: 'dimensions',
  spacing: 'spacing',
  typography: 'typography',
  background: 'colors',
  border: 'borders',
  effects: 'effects',
  position: 'positioning',
  misc: 'other'
};
const LABELS: Readonly<Record<PanelCategory, string>> = {
  layout: 'Layout',
  dimensions: 'Dimensões',
  spacing: 'Espaçamento',
  typography: 'Tipografia',
  colors: 'Cores',
  borders: 'Bordas',
  effects: 'Efeitos',
  positioning: 'Posicionamento',
  other: 'Outros'
};
const ORDER: readonly PanelCategory[] = [
  'layout',
  'dimensions',
  'spacing',
  'typography',
  'colors',
  'borders',
  'effects',
  'positioning',
  'other'
];

export function panelCategory(category: Category): PanelCategory {
  return CATEGORY_MAP[category];
}
export function groupConversions(conversions: readonly Conversion[]): ClassGroup[] {
  return ORDER.map((category) => {
    const items = conversions.filter((item) => panelCategory(item.category) === category);
    return {
      category,
      label: LABELS[category],
      classes: [...new Set(items.flatMap((item) => item.classes))],
      conversions: items
    };
  }).filter((group) => group.conversions.length > 0);
}
