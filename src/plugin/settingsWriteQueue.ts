export class LatestWriteQueue<T> {
  private chain: Promise<void> = Promise.resolve();
  private version = 0;

  constructor(private readonly writer: (value: T) => Promise<void>) {}

  enqueue(value: T): Promise<void> {
    const version = ++this.version;
    const task = this.chain
      .catch(() => undefined)
      .then(async () => {
        if (version !== this.version) return;
        await this.writer(value);
      });
    this.chain = task.catch(() => undefined);
    return task;
  }

  async idle(): Promise<void> {
    await this.chain;
  }
}
