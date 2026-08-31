import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type UiMessage } from '../src/types';

interface FigmaHarness {
  selection: SceneNode[];
  posts: unknown[];
  listeners: Map<string, () => void>;
  send: (message: UiMessage) => void;
  sendRaw: (message: unknown) => void;
  storageWrites: unknown[];
  setNode: (node: SceneNode | null) => void;
}

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

async function loadMain(
  options: { storageValue?: Promise<unknown>; waitForSelection?: boolean } = {}
): Promise<FigmaHarness> {
  vi.resetModules();
  const posts: unknown[] = [],
    listeners = new Map<string, () => void>(),
    storageWrites: unknown[] = [];
  let found: SceneNode | null = null;
  const ui = {
    postMessage: vi.fn((message: unknown) => posts.push(message)),
    resize: vi.fn(),
    onmessage: ((_message: unknown) => {}) as (message: unknown) => void
  };
  const currentPage: { selection: SceneNode[] } = { selection: [] };
  const figmaMock = {
    currentPage,
    ui,
    showUI: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => listeners.set(event, handler)),
    clientStorage: {
      getAsync: vi.fn(async () => options.storageValue ?? undefined),
      setAsync: vi.fn(async (_key: string, value: unknown) => {
        storageWrites.push(value);
      })
    },
    getNodeByIdAsync: vi.fn(async () => found),
    base64Encode: vi.fn(() => 'aA==')
  };
  vi.stubGlobal('__html__', '<html></html>');
  vi.stubGlobal('figma', figmaMock);
  await import('../src/plugin/main');
  if (options.waitForSelection !== false)
    await vi.waitFor(() => expect(posts.some((item) => (item as { type?: string }).type === 'selection')).toBe(true));
  return {
    selection: currentPage.selection,
    posts,
    listeners,
    send: (message) => ui.onmessage(message),
    sendRaw: (message) => ui.onmessage(message),
    storageWrites,
    setNode: (node) => {
      found = node;
    }
  };
}

const previewNode = (id: string, exportPromise: Promise<Uint8Array>): SceneNode =>
  ({
    id,
    name: id,
    type: 'RECTANGLE',
    width: 100,
    height: 40,
    x: 0,
    y: 0,
    visible: true,
    parent: null,
    exportAsync: vi.fn(() => exportPromise),
    fills: [],
    strokes: [],
    strokeWeight: 0,
    dashPattern: [],
    effects: [],
    opacity: 1,
    cornerRadius: 0
  }) as unknown as SceneNode;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('main do plugin', () => {
  it('não deixa settings carregados com atraso sobrescreverem uma escolha nova', async () => {
    const stored = deferred<unknown>();
    const app = await loadMain({ storageValue: stored.promise, waitForSelection: false });
    const chosen = { ...DEFAULT_SETTINGS, defaultFontFamily: 'Inter' };
    app.send({ type: 'save-settings', settings: chosen });
    stored.resolve({ version: 5, settings: { ...DEFAULT_SETTINGS, defaultFontFamily: 'Old Font' } });

    await vi.waitFor(() => {
      const settingsPosts = app.posts.filter((item) => (item as { type?: string }).type === 'settings');
      expect(settingsPosts[settingsPosts.length - 1]).toMatchObject({ settings: { defaultFontFamily: 'Inter' } });
    });
    expect(app.storageWrites[app.storageWrites.length - 1]).toMatchObject({
      settings: { defaultFontFamily: 'Inter' }
    });
  });

  it('carrega settings, ignora mensagem inválida e persiste apenas o save mais recente', async () => {
    const app = await loadMain();
    expect(app.posts.some((item) => (item as { type?: string }).type === 'settings')).toBe(true);
    app.send({
      type: 'save-settings',
      settings: {
        preferDefaults: true,
        useRem: false,
        colorFormat: 'hex',
        ignoreAutomaticTextDimensions: true,
        alignmentTolerancePx: 8,
        gapTolerancePx: 4,
        groupGapFactor: 2.5,
        minimumStructureConfidence: 0.75,
        outputProfile: 'optimized',
        tailwindVersion: '4',
        defaultFontFamily: 'Inter',
        tokenMappings: '',
        smartDebug: false,
        responsiveCompare: DEFAULT_SETTINGS.responsiveCompare
      }
    });
    await vi.waitFor(() => expect(JSON.stringify(app.storageWrites[app.storageWrites.length - 1])).toContain('Inter'));
    const before = app.posts.length;
    app.sendRaw({ type: 'unknown' });
    expect(app.posts.slice(before).some((item) => (item as { type?: string }).type === 'notice')).toBe(true);
  });

  it('descarta preview A atrasado depois que a seleção muda para C', async () => {
    const app = await loadMain();
    vi.useFakeTimers();
    const exported = deferred<Uint8Array>();
    const a = previewNode('A', exported.promise);
    app.selection.splice(0, app.selection.length, a);
    app.setNode(a);
    app.listeners.get('selectionchange')?.();
    await vi.runAllTimersAsync();
    const pendingMessages = app.posts.filter((item) => (item as { type?: string }).type === 'selection-pending');
    const pending = pendingMessages[pendingMessages.length - 1] as { requestId: number };
    app.send({ type: 'request-preview', requestId: pending.requestId, nodeId: 'A' });
    await Promise.resolve();
    const c = previewNode('C', Promise.resolve(new Uint8Array([1])));
    app.selection.splice(0, app.selection.length, c);
    app.setNode(c);
    app.listeners.get('selectionchange')?.();
    exported.resolve(new Uint8Array([1]));
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(
      app.posts.some(
        (item) =>
          (item as { type?: string; nodeId?: string; dataUrl?: string }).type === 'preview' &&
          (item as { nodeId?: string }).nodeId === 'A' &&
          (item as { dataUrl?: string }).dataUrl
      )
    ).toBe(false);
  });

  it('analisa várias raízes em uma única solicitação protegida', async () => {
    const app = await loadMain();
    vi.useFakeTimers();
    const nodes = ['A', 'B', 'C'].map((id) => previewNode(id, Promise.resolve(new Uint8Array([1]))));
    app.selection.splice(0, app.selection.length, ...nodes);
    app.listeners.get('selectionchange')?.();
    await vi.runAllTimersAsync();
    const pendingMessages = app.posts.filter((item) => (item as { type?: string }).type === 'selection-pending');
    const pending = pendingMessages[pendingMessages.length - 1] as { requestId: number };
    app.send({
      type: 'request-selection-details',
      requestId: pending.requestId,
      nodeIds: nodes.map((node) => node.id)
    });
    await Promise.resolve();
    const details = app.posts.filter(
      (item) =>
        (item as { type?: string; requestId?: number }).type === 'node-details' &&
        (item as { requestId?: number }).requestId === pending.requestId
    );
    expect(details).toHaveLength(3);
    expect(details.map((item) => (item as { nodeId?: string }).nodeId)).toEqual(['A', 'B', 'C']);
  });

  it('envia uma seleção única pronta para gerar código sem aguardar outra solicitação da UI', async () => {
    const app = await loadMain();
    vi.useFakeTimers();
    const frame = {
      ...previewNode('frame', Promise.resolve(new Uint8Array([1]))),
      type: 'FRAME',
      children: []
    } as unknown as SceneNode;
    app.selection.splice(0, app.selection.length, frame);

    app.listeners.get('selectionchange')?.();
    await vi.runAllTimersAsync();

    const selections = app.posts.filter((item) => (item as { type?: string }).type === 'selection');
    const latest = selections[selections.length - 1] as {
      nodes: Array<{ id: string; detailsLoaded?: boolean; codegen?: unknown }>;
    };
    expect(latest.nodes).toMatchObject([{ id: 'frame', detailsLoaded: true }]);
    expect(latest.nodes[0]?.codegen).toBeDefined();
  });

  it('encerra detalhes e preview quando o node solicitado deixa de existir', async () => {
    const app = await loadMain();
    vi.useFakeTimers();
    const node = previewNode('gone', Promise.resolve(new Uint8Array([1])));
    app.selection.splice(0, app.selection.length, node);
    app.listeners.get('selectionchange')?.();
    await vi.runAllTimersAsync();
    const pendingMessages = app.posts.filter((item) => (item as { type?: string }).type === 'selection-pending');
    const pending = pendingMessages[pendingMessages.length - 1] as { requestId: number };
    app.setNode(null);
    app.send({ type: 'request-node-details', requestId: pending.requestId, nodeId: node.id });
    app.send({ type: 'request-preview', requestId: pending.requestId, nodeId: node.id });
    await vi.waitFor(() =>
      expect(
        app.posts.some(
          (item) =>
            (item as { type?: string; nodeId?: string; error?: string }).type === 'node-details' &&
            (item as { nodeId?: string }).nodeId === node.id &&
            Boolean((item as { error?: string }).error)
        )
      ).toBe(true)
    );
    expect(
      app.posts.some(
        (item) =>
          (item as { type?: string; nodeId?: string }).type === 'preview' &&
          (item as { nodeId?: string }).nodeId === node.id
      )
    ).toBe(true);
  });
});
