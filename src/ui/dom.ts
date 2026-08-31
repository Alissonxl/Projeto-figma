export function clearElement(element: Element): void {
  element.replaceChildren();
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attributes?: Readonly<Record<string, string>> } = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) element.setAttribute(name, value);
  return element;
}

export function replaceTextList(container: Element, items: readonly { text: string; className?: string }[]): void {
  container.replaceChildren(
    ...items.map((item) =>
      createElement('li', { text: item.text, ...(item.className ? { className: item.className } : {}) })
    )
  );
}
