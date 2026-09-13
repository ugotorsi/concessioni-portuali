export interface AsyncJobHandlerContext {
  readonly jobId: string;
  readonly correlationId: string;
  readonly attempt: number;
  isCancellationRequested(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export interface AsyncJobHandler<TInput = unknown> {
  readonly operation: string;
  parseInput(input: unknown): TInput;
  execute(input: TInput, context: AsyncJobHandlerContext): Promise<unknown>;
}

export class AsyncJobHandlerRegistry {
  readonly #handlers = new Map<string, AsyncJobHandler>();

  constructor(handlers: readonly AsyncJobHandler[] = []) {
    for (const handler of handlers) {
      if (this.#handlers.has(handler.operation)) {
        throw new Error(`DUPLICATE_ASYNC_JOB_HANDLER:${handler.operation}`);
      }
      this.#handlers.set(handler.operation, handler);
    }
  }

  resolve(operation: string): AsyncJobHandler | null {
    return this.#handlers.get(operation) ?? null;
  }
}

export const asyncJobHandlerRegistry = new AsyncJobHandlerRegistry();