import type { ResponsiveBreakpoint, ResponsiveCompareSettings, ResponsiveFrameInfo } from '../types';

const ORDER: Exclude<ResponsiveBreakpoint, 'base'>[] = ['sm', 'md', 'lg', 'xl', '2xl'];

export function resolveResponsiveBreakpoints(
  frames: readonly ResponsiveFrameInfo[],
  settings: ResponsiveCompareSettings
): ResponsiveFrameInfo[] {
  const sorted = [...frames].sort((left, right) => left.width - right.width);
  const used = new Set<ResponsiveBreakpoint>(['base']);
  let minimumIndex = 0;
  return sorted.map((frame) => {
    if (frame.isBase) return { ...frame, breakpoint: 'base' };
    if (!settings.autoBreakpointSuggestion && frame.breakpointConfidence < 1)
      return { ...frame, breakpoint: 'base', breakpointConfidence: 0 };
    let breakpoint = frame.breakpoint === 'base' ? ORDER[minimumIndex]! : frame.breakpoint;
    let index = Math.max(minimumIndex, ORDER.indexOf(breakpoint));
    if (frame.breakpointConfidence === 1) {
      used.add(breakpoint);
      minimumIndex = Math.max(minimumIndex, Math.min(ORDER.length - 1, index + 1));
      return { ...frame, breakpoint };
    }
    while (index < ORDER.length - 1 && used.has(ORDER[index]!)) index += 1;
    breakpoint = ORDER[Math.max(0, index)]!;
    used.add(breakpoint);
    minimumIndex = Math.min(ORDER.length - 1, index + 1);
    return { ...frame, breakpoint };
  });
}
