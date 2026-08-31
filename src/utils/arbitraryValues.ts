export function escapeArbitraryString(value: string): string {
  return value
    .trim()
    .slice(0, 200)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/_/g, '\\_')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\s+/g, '_');
}

export function arbitraryFontFamilyClass(value: string): string {
  return `font-['${escapeArbitraryString(value)}']`;
}
