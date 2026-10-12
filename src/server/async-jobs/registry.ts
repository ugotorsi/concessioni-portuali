import type { Prisma } from "@/generated/prisma/client";

import type { AsyncJobFailure } from "./domain";

export interface AsyncJobHandlerContext {
  readonly jobId: string;
  readonly correlationId: string;
  readonly attempt: number;
  isCancellationRequested(): Promise<boolean>;
  heartbeat(): Promise<void>;
}

export interface AsyncJobTerminalFailureContext {
  readonly jobId: string;
  readonly operation: string;
  readonly tenantId: string | null;
  readonly correlationId: string;
  readonly inputReference: unknown;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly failure: AsyncJobFailure;
}

export type AsyncJobTerminalFailureResolution =
  | { readonly outcome: "TERMINAL_FAILED" }
  | { readonly outcome: "SUCCEEDED"; readonly resultReference: unknown };

export type AsyncJobTerminalFailureHook = (
  tx: Prisma.TransactionClient,
  context: AsyncJobTerminalFailureContext,
) => Promise<AsyncJobTerminalFailureResolution>;

export interface AsyncJobHandler<TInput = unknown> {
  readonly operation: string;
  parseInput(input: unknown): TInput;
  execute(input: TInput, context: AsyncJobHandlerContext): Promise<unknown>;
  beforeTerminalFailureInTransaction?: AsyncJobTerminalFailureHook;
}

export class AsyncJobHandlerRegistry {
  readonly #handlers = new Map<string, AsyncJobHandler>();
  readonly #hasTerminalFailureHooks: boolean;

  constructor(handlers: readonly AsyncJobHandler[] = []) {
    for (const handler of handlers) {
      if (this.#handlers.has(handler.operation)) {
        throw new Error(`DUPLICATE_ASYNC_JOB_HANDLER:${handler.operation}`);
      }
      this.#handlers.set(handler.operation, handler);
    }
    this.#hasTerminalFailureHooks = handlers.some((handler) =>
      handler.beforeTerminalFailureInTransaction !== undefined);
  }

  resolve(operation: string): AsyncJobHandler | null {
    return this.#handlers.get(operation) ?? null;
  }

  hasTerminalFailureHooks(): boolean {
    return this.#hasTerminalFailureHooks;
  }
}

export const asyncJobHandlerRegistry = new AsyncJobHandlerRegistry();