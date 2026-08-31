export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();
  private currentWeight = 0;
  constructor(
    readonly capacity: number,
    readonly maxWeight = Number.POSITIVE_INFINITY,
    private readonly weigh: (value: V) => number = () => 1
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('LRU capacity must be a positive integer.');
    if (maxWeight <= 0) throw new Error('LRU maxWeight must be positive.');
  }
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  set(key: K, value: V): void {
    const previous = this.entries.get(key);
    if (previous !== undefined) this.currentWeight -= this.measure(previous);
    this.entries.delete(key);
    this.entries.set(key, value);
    this.currentWeight += this.measure(value);
    while (this.entries.size > this.capacity || this.currentWeight > this.maxWeight) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.entries.get(oldest);
      if (removed !== undefined) this.currentWeight -= this.measure(removed);
      this.entries.delete(oldest);
    }
  }
  has(key: K): boolean {
    return this.entries.has(key);
  }
  delete(key: K): boolean {
    const value = this.entries.get(key);
    if (value !== undefined) this.currentWeight -= this.measure(value);
    return this.entries.delete(key);
  }
  clear(): void {
    this.entries.clear();
    this.currentWeight = 0;
  }
  get size(): number {
    return this.entries.size;
  }
  get weight(): number {
    return this.currentWeight;
  }
  private measure(value: V): number {
    const result = this.weigh(value);
    return Number.isFinite(result) && result > 0 ? result : 1;
  }
}
