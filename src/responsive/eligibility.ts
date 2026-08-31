export const RESPONSIVE_FRAME_MIN_WIDTH = 240;
export const RESPONSIVE_FRAME_MIN_SPREAD = 120;
const RESPONSIVE_CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION', 'COMPONENT_SET']);

export function isResponsiveContainerType(type: string): boolean {
  return RESPONSIVE_CONTAINER_TYPES.has(type);
}

export function plausibleResponsiveWidths(widths: readonly number[]): boolean {
  if (widths.length < 2 || widths.length > 5 || widths.some((width) => !Number.isFinite(width) || width <= 0))
    return false;
  const rounded = widths.map((width) => Math.round(width * 100) / 100);
  const minimum = Math.min(...rounded);
  const maximum = Math.max(...rounded);
  return (
    minimum >= RESPONSIVE_FRAME_MIN_WIDTH &&
    maximum - minimum >= RESPONSIVE_FRAME_MIN_SPREAD &&
    new Set(rounded).size === rounded.length
  );
}
