export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
export const MAX_PREVIEW_DATA_URL_CHARACTERS = 6_000_000;

export function previewBytesFitDataUrl(byteLength: number): boolean {
  if (!Number.isFinite(byteLength) || byteLength < 0) return false;
  const encodedCharacters = Math.ceil(byteLength / 3) * 4;
  return PNG_DATA_URL_PREFIX.length + encodedCharacters <= MAX_PREVIEW_DATA_URL_CHARACTERS;
}
