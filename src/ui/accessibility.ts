export type TabNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function isTabActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

export function nextTabIndex(current: number, key: string, length: number): number | null {
  if (length < 1) return null;
  if (key === 'ArrowRight') return (current + 1) % length;
  if (key === 'ArrowLeft') return (current - 1 + length) % length;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return null;
}
