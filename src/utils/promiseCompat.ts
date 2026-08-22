type PromiseWithResolversShape<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseCompatConstructor = PromiseConstructor & {
  try?: <T>(fn: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) => Promise<T>;
  withResolvers?: <T>() => PromiseWithResolversShape<T>;
};

export function installPromiseCompat(target: typeof globalThis = globalThis): void {
  const promiseCtor = target.Promise as PromiseCompatConstructor;

  if (typeof promiseCtor.try !== "function") {
    const promiseTry = function <T>(fn: (...args: unknown[]) => T | PromiseLike<T>, ...args: unknown[]) {
      return new Promise<T>((resolve, reject) => {
        try {
          resolve(fn(...args));
        } catch (error) {
          reject(error);
        }
      });
    };
    try { Object.defineProperty(promiseCtor, "try", { configurable: true, value: promiseTry }); } catch { /* readonly WebKit */ }
  }

  if (typeof promiseCtor.withResolvers !== "function") {
    const withResolvers = function <T>(): PromiseWithResolversShape<T> {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
    try { Object.defineProperty(promiseCtor, "withResolvers", { configurable: true, value: withResolvers }); } catch { /* readonly WebKit */ }
  }
}
