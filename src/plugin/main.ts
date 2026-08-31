import { DEFAULT_SETTINGS, type ParsedNode, type Settings, type UiMessage } from '../types';
import { LruCache } from '../utils/lruCache';
import { logger } from '../utils/logger';
import { parseUiMessage } from '../utils/runtimeValidation';
import { migrateSettings, settingsSignature, storedSettings } from '../utils/settings';
import { RequestTracker } from './requestTracker';
import {
  exportNodePreview,
  parseNodeDetails,
  parseResponsiveSelectionDetails,
  parseSelectionDetails,
  parseSelectionSummary,
  type SelectionParseResult
} from './selection';
import { ANALYSIS_LIMITS } from './analysisBudget';
import { LatestWriteQueue } from './settingsWriteQueue';
import { approximatePayloadBytes } from './payloadBudget';
import { isResponsiveContainerType, plausibleResponsiveWidths } from '../responsive/eligibility';

figma.showUI(__html__, { width: 440, height: 680, themeColors: true });

const STORAGE_KEY = 'settings-v5';
const LEGACY_STORAGE_KEYS = ['settings-v4', 'settings-v3', 'settings-v2', 'settings'] as const;
const tracker = new RequestTracker();
const selectionCache = new LruCache<string, SelectionParseResult>(8);
const detailCache = new LruCache<string, ParsedNode>(32, 12_000_000, approximatePayloadBytes);
const previewCache = new LruCache<string, string>(
  ANALYSIS_LIMITS.maxPreviewNodes,
  20_000_000,
  (value) => value.length * 2
);
const pendingDetails = new Set<string>();
const pendingPreviews = new Set<string>();
const pendingSelectionDetails = new Set<number>();
const batchedDetailNodes = new Set<string>();
const settingsWrites = new LatestWriteQueue<ReturnType<typeof storedSettings>>((value) =>
  figma.clientStorage.setAsync(STORAGE_KEY, value)
);

let settings: Settings = DEFAULT_SETTINGS;
let debounceHandle: number | undefined;
let settingsMutationVersion = 0;

function selectedIds(): string[] {
  return figma.currentPage.selection.map((node) => node.id);
}

function selectionCacheKey(): string {
  return `${selectedIds().join('|')}::${settingsSignature(settings)}`;
}

function nodeCacheKey(nodeId: string): string {
  return `${selectedIds().join('|')}::${nodeId}::${settingsSignature(settings)}`;
}

function isCurrent(requestId: number): boolean {
  return tracker.isCurrent(requestId, selectedIds());
}

function beginRequest(): number {
  batchedDetailNodes.clear();
  pendingDetails.clear();
  pendingPreviews.clear();
  pendingSelectionDetails.clear();
  return tracker.begin(selectedIds());
}

function clearAnalysisCaches(): void {
  selectionCache.clear();
  detailCache.clear();
  previewCache.clear();
}

function postNotice(message: string): void {
  figma.ui.postMessage({ type: 'notice', message });
}

async function sendSelection(requestId: number, force = false): Promise<void> {
  try {
    if (!isCurrent(requestId)) return;
    const key = selectionCacheKey();
    let result = force ? undefined : selectionCache.get(key);
    if (!result) {
      const selected = [...figma.currentPage.selection];
      // A seleção única é o caminho mais comum do plugin. Envie o Frame já
      // analisado para que o JSX não dependa de uma segunda mensagem da UI.
      // O mesmo orçamento de segurança continua limitando Frames grandes.
      if (selected.length === 1) {
        const details = parseSelectionDetails(selected, settings);
        result = { nodes: details.nodes, analysis: details.analysis };
      } else result = parseSelectionSummary(settings);
      if (!result.nodes.some((node) => node.parseError)) selectionCache.set(key, result);
    }
    if (!isCurrent(requestId)) return;
    figma.ui.postMessage({ type: 'selection', requestId, nodes: result.nodes, analysis: result.analysis });
  } catch (error) {
    logger.error('selection-analysis-failed', { error: error instanceof Error ? error.message : 'unknown' });
    if (!isCurrent(requestId)) return;
    figma.ui.postMessage({
      type: 'selection',
      requestId,
      nodes: [],
      analysis: { partial: false, analyzed: 0, skipped: 0 },
      error: error instanceof Error ? error.message : 'Falha ao analisar a seleção.'
    });
  }
}

function scheduleSelection(force = false, clearCaches = true): void {
  const requestId = beginRequest();
  figma.ui.postMessage({ type: 'selection-pending', requestId });
  if (clearCaches) clearAnalysisCaches();
  if (debounceHandle !== undefined) clearTimeout(debounceHandle);
  debounceHandle = setTimeout(() => {
    debounceHandle = undefined;
    void sendSelection(requestId, force);
  }, 100);
}

function belongsToCurrentSelection(node: SceneNode): boolean {
  const roots = new Set(selectedIds());
  let current: BaseNode | null = node;
  while (current) {
    if (roots.has(current.id)) return true;
    current = current.parent;
  }
  return false;
}

async function getSelectedSceneNode(nodeId: string): Promise<SceneNode | null> {
  const found = await figma.getNodeByIdAsync(nodeId);
  if (!found || !('width' in found) || !belongsToCurrentSelection(found)) return null;
  return found;
}

async function sendNodeDetails(requestId: number, nodeId: string): Promise<void> {
  const pendingKey = `${requestId}:${nodeId}`;
  if (!isCurrent(requestId) || pendingDetails.has(pendingKey) || batchedDetailNodes.has(pendingKey)) return;
  pendingDetails.add(pendingKey);
  try {
    const cacheKey = nodeCacheKey(nodeId);
    const cached = detailCache.get(cacheKey);
    if (cached) {
      if (isCurrent(requestId)) {
        figma.ui.postMessage({
          type: 'node-details',
          requestId,
          nodeId,
          node: cached,
          analysis: { partial: cached.analysisLimited, analyzed: 1, skipped: 0 }
        });
      }
      return;
    }
    const node = await getSelectedSceneNode(nodeId);
    if (!isCurrent(requestId) || batchedDetailNodes.has(pendingKey)) return;
    if (!node) {
      figma.ui.postMessage({
        type: 'node-details',
        requestId,
        nodeId,
        error: 'Este elemento não está mais disponível na seleção atual.'
      });
      return;
    }
    const result = parseNodeDetails(node, settings);
    if (!isCurrent(requestId) || batchedDetailNodes.has(pendingKey)) return;
    if (result.node && !result.error && !result.node.parseError) detailCache.set(cacheKey, result.node);
    figma.ui.postMessage({ type: 'node-details', requestId, nodeId, ...result });
  } catch (error) {
    logger.warn('node-details-failed', { nodeId, error: error instanceof Error ? error.message : 'unknown' });
    if (isCurrent(requestId)) {
      figma.ui.postMessage({
        type: 'node-details',
        requestId,
        nodeId,
        error: 'Não foi possível analisar os detalhes deste elemento.'
      });
    }
  } finally {
    pendingDetails.delete(pendingKey);
  }
}

async function sendSelectionDetails(requestId: number, nodeIds: readonly string[]): Promise<void> {
  if (!isCurrent(requestId) || pendingSelectionDetails.has(requestId)) return;
  pendingSelectionDetails.add(requestId);
  for (const nodeId of nodeIds) batchedDetailNodes.add(`${requestId}:${nodeId}`);
  try {
    const selected = new Map(figma.currentPage.selection.map((node) => [node.id, node]));
    const requested = nodeIds.map((nodeId) => selected.get(nodeId)).filter((node): node is SceneNode => !!node);
    if (requested.length !== nodeIds.length || !isCurrent(requestId)) {
      postNotice('A seleção mudou antes da análise completa; a solicitação antiga foi ignorada.');
      return;
    }
    const responsiveRequest =
      settings.responsiveCompare.enabled &&
      requested.length >= 2 &&
      requested.length <= 5 &&
      requested.every((node) => isResponsiveContainerType(node.type)) &&
      plausibleResponsiveWidths(requested.map((node) => node.width));
    const result = responsiveRequest
      ? parseResponsiveSelectionDetails(requested, settings)
      : parseSelectionDetails(requested, settings);
    if (!isCurrent(requestId)) return;
    for (const node of result.nodes) {
      detailCache.set(nodeCacheKey(node.id), node);
      figma.ui.postMessage({
        type: 'node-details',
        requestId,
        nodeId: node.id,
        node,
        analysis: result.analysis
      });
    }
    for (const nodeId of result.omittedNodeIds)
      figma.ui.postMessage({
        type: 'node-details',
        requestId,
        nodeId,
        analysis: result.analysis,
        error: 'Detalhes não analisados: o limite seguro da seleção completa foi atingido.'
      });
  } catch (error) {
    logger.warn('selection-details-failed', { error: error instanceof Error ? error.message : 'unknown' });
    if (isCurrent(requestId))
      for (const nodeId of nodeIds)
        figma.ui.postMessage({
          type: 'node-details',
          requestId,
          nodeId,
          error: 'Não foi possível analisar este elemento na seleção completa.'
        });
  } finally {
    pendingSelectionDetails.delete(requestId);
  }
}

async function sendPreview(requestId: number, nodeId: string): Promise<void> {
  const pendingKey = `${requestId}:${nodeId}`;
  if (!isCurrent(requestId) || pendingPreviews.has(pendingKey)) return;
  const cached = previewCache.get(nodeCacheKey(nodeId));
  if (cached) {
    figma.ui.postMessage({ type: 'preview', requestId, nodeId, dataUrl: cached });
    return;
  }
  pendingPreviews.add(pendingKey);
  try {
    const node = await getSelectedSceneNode(nodeId);
    if (!isCurrent(requestId)) return;
    if (!node) {
      figma.ui.postMessage({ type: 'preview', requestId, nodeId });
      return;
    }
    const dataUrl = await exportNodePreview(node);
    if (!isCurrent(requestId)) return;
    if (dataUrl) previewCache.set(nodeCacheKey(nodeId), dataUrl);
    figma.ui.postMessage({ type: 'preview', requestId, nodeId, ...(dataUrl ? { dataUrl } : {}) });
  } catch (error) {
    logger.warn('preview-failed', { nodeId, error: error instanceof Error ? error.message : 'unknown' });
    if (isCurrent(requestId)) figma.ui.postMessage({ type: 'preview', requestId, nodeId });
  } finally {
    pendingPreviews.delete(pendingKey);
  }
}

async function loadSettings(): Promise<void> {
  const loadVersion = settingsMutationVersion;
  try {
    const current: unknown = await figma.clientStorage.getAsync(STORAGE_KEY);
    let legacy: unknown;
    if (current === undefined)
      for (const key of LEGACY_STORAGE_KEYS) {
        legacy = await figma.clientStorage.getAsync(key);
        if (legacy !== undefined) break;
      }
    const migrated = migrateSettings(current ?? legacy);
    if (settingsMutationVersion === loadVersion) {
      settings = migrated.settings;
      if (current === undefined) await settingsWrites.enqueue(migrated);
    }
  } catch (error) {
    logger.warn('settings-load-failed', { error: error instanceof Error ? error.message : 'unknown' });
    if (settingsMutationVersion === loadVersion) {
      settings = { ...DEFAULT_SETTINGS };
      postNotice('Não foi possível carregar as preferências; os valores padrão foram usados.');
    }
  }
  figma.ui.postMessage({ type: 'settings', settings });
  const requestId = beginRequest();
  await sendSelection(requestId);
}

void loadSettings();

figma.on('selectionchange', () => scheduleSelection());
figma.on('currentpagechange', () => scheduleSelection());

figma.ui.onmessage = (raw: unknown) => {
  const message: UiMessage | null = parseUiMessage(raw);
  if (!message) {
    postNotice('Uma mensagem inválida da interface foi ignorada.');
    return;
  }
  if (message.type === 'refresh') {
    clearAnalysisCaches();
    const requestId = beginRequest();
    figma.ui.postMessage({ type: 'selection-pending', requestId });
    void sendSelection(requestId, true);
  }
  if (message.type === 'resize') figma.ui.resize(440, message.height);
  if (message.type === 'reset-settings') {
    settingsMutationVersion += 1;
    settings = { ...DEFAULT_SETTINGS };
    clearAnalysisCaches();
    figma.ui.postMessage({ type: 'settings', settings });
    void settingsWrites
      .enqueue(storedSettings(settings))
      .catch(() => postNotice('Não foi possível salvar as preferências.'));
    const requestId = beginRequest();
    figma.ui.postMessage({ type: 'selection-pending', requestId });
    void sendSelection(requestId, true);
  }
  if (message.type === 'save-settings') {
    settingsMutationVersion += 1;
    settings = message.settings;
    clearAnalysisCaches();
    void settingsWrites
      .enqueue(storedSettings(settings))
      .catch(() => postNotice('Não foi possível salvar as preferências.'));
    scheduleSelection(true, false);
  }
  if (message.type === 'request-node-details' && message.requestId === tracker.current) {
    void sendNodeDetails(message.requestId, message.nodeId);
  }
  if (message.type === 'request-selection-details' && message.requestId === tracker.current) {
    void sendSelectionDetails(message.requestId, message.nodeIds);
  }
  if (message.type === 'request-preview' && message.requestId === tracker.current) {
    void sendPreview(message.requestId, message.nodeId);
  }
};
