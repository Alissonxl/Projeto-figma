function fallbackCopy(value: string): boolean {
  let textarea: HTMLTextAreaElement | undefined;
  let previousFocus: HTMLElement | null = null;
  try {
    const focusCandidate = document.activeElement as HTMLElement | null | undefined;
    previousFocus = focusCandidate && typeof focusCandidate.focus === 'function' ? focusCandidate : null;
  } catch {
    // Restoring focus is optional in restricted plugin environments.
  }
  try {
    textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    return success;
  } catch {
    return false;
  } finally {
    try {
      textarea?.remove();
    } catch {
      // Cleanup must not turn a successful copy into an unhandled rejection.
    }
    try {
      previousFocus?.focus();
    } catch {
      // Some embedded browsers reject focus restoration after execCommand.
    }
  }
}

export async function writeClipboard(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return fallbackCopy(value);
  }
}
