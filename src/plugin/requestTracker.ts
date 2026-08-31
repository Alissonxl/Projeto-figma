export class RequestTracker {
  private revision = 0;
  private selection = '';

  begin(selectionIds: readonly string[]): number {
    this.revision++;
    this.selection = selectionIds.join('|');
    return this.revision;
  }

  isCurrent(requestId: number, selectionIds: readonly string[]): boolean {
    return requestId === this.revision && this.selection === selectionIds.join('|');
  }

  get current(): number {
    return this.revision;
  }
}
