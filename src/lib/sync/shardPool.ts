export interface ShardHandle<T> {
  name: string;
  value: T;
  close: () => Promise<void> | void;
}

export class ShardPool<T> {
  private readonly handles = new Map<string, ShardHandle<T>>();
  constructor(private readonly maxOpen = 4) {}

  async open(name: string, create: () => Promise<ShardHandle<T>>): Promise<ShardHandle<T>> {
    const existing = this.handles.get(name);
    if (existing) return existing;
    if (this.handles.size >= this.maxOpen) {
      const oldest = this.handles.values().next().value as ShardHandle<T> | undefined;
      if (oldest) {
        this.handles.delete(oldest.name);
        await oldest.close();
      }
    }
    const handle = await create();
    this.handles.set(name, handle);
    return handle;
  }

  async close(name: string): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle) return;
    this.handles.delete(name);
    await handle.close();
  }

  async closeAll(): Promise<void> {
    const handles = Array.from(this.handles.values());
    this.handles.clear();
    await Promise.all(handles.map((handle) => handle.close()));
  }

  names(): string[] { return Array.from(this.handles.keys()); }
}
