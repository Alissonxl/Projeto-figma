import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from '../src/ui/clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('clipboard', () => {
  it('rejeita valor vazio', async () => expect(writeClipboard('')).resolves.toBe(false));
  it('usa Clipboard API quando disponível', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('flex')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('flex');
  });
  it('usa fallback e não lança quando Clipboard API falha', async () => {
    const textarea = { value: '', style: { position: '', opacity: '' }, select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        })
      }
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true)
    });
    await expect(writeClipboard('grid')).resolves.toBe(true);
    expect(textarea.select).toHaveBeenCalled();
  });
  it('não perde uma cópia bem-sucedida quando restaurar o foco falha', async () => {
    const textarea = { value: '', style: { position: '', opacity: '' }, select: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        })
      }
    });
    vi.stubGlobal('document', {
      activeElement: {
        focus: vi.fn(() => {
          throw new Error('detached');
        })
      },
      createElement: vi.fn(() => textarea),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true)
    });

    await expect(writeClipboard('grid')).resolves.toBe(true);
  });
});
