import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { ExtractionFailure } from "./errors";
import type { OcrAdapter, OcrResult } from "./types";

const require = createRequire(import.meta.url);
const italianLanguagePath = path.dirname(
  require.resolve("@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz"),
);

const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { createWorker, OEM } = require("tesseract.js");

  (async () => {
    let worker;
    try {
      worker = await createWorker("ita", OEM.LSTM_ONLY, {
        langPath: workerData.langPath,
        gzip: true,
        cacheMethod: "none",
        errorHandler: () => undefined,
      });
      const result = await worker.recognize(Buffer.from(workerData.image));
      await worker.terminate();
      worker = undefined;
      parentPort.postMessage({
        ok: true,
        text: result.data.text,
        confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null,
      });
    } catch (_error) {
      if (worker) {
        try { await worker.terminate(); } catch (_cleanupError) {}
      }
      parentPort.postMessage({ ok: false });
    }
  })();
`;

export interface OcrExecution {
  readonly result: Promise<OcrResult>;
  terminate(): Promise<unknown>;
}

export type OcrExecutionFactory = (image: Buffer, langPath: string) => OcrExecution;

const createOcrExecution: OcrExecutionFactory = (image, langPath) => {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { image, langPath },
  });
  const result = new Promise<OcrResult>((resolve, reject) => {
    let receivedResult = false;
    worker.once("message", (message: { ok: boolean; text?: string; confidence?: number | null }) => {
      receivedResult = true;
      if (message.ok && typeof message.text === "string") {
        resolve({ text: message.text, confidence: message.confidence ?? null });
      } else {
        reject(new ExtractionFailure("OCR_ENGINE_FAILURE"));
      }
    });
    worker.once("error", () => reject(new ExtractionFailure("OCR_ENGINE_FAILURE")));
    worker.once("exit", (code) => {
      if (!receivedResult && code !== 0) {
        reject(new ExtractionFailure("OCR_ENGINE_FAILURE"));
      }
    });
  });
  return { result, terminate: () => worker.terminate() };
};

export class TesseractItalianOcrAdapter implements OcrAdapter {
  readonly name = "tesseract.js";
  readonly version = "6.0.1";

  constructor(private readonly executionFactory: OcrExecutionFactory = createOcrExecution) {}

  async recognize(image: Buffer, timeoutMs: number): Promise<OcrResult> {
    const deadline = Date.now() + timeoutMs;
    let execution: OcrExecution;
    try {
      execution = this.executionFactory(image, italianLanguagePath);
    } catch (error) {
      throw new ExtractionFailure("OCR_ENGINE_FAILURE", undefined, error);
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      void execution.terminate().catch(() => undefined);
      throw new ExtractionFailure("OCR_TIMEOUT");
    }
    return new Promise<OcrResult>((resolve, reject) => {
      let settled = false;
      const finish = (result: { value: OcrResult } | { error: ExtractionFailure }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void execution.terminate().catch(() => undefined);
        if ("value" in result) resolve(result.value);
        else reject(result.error);
      };
      const timeout = setTimeout(
        () => finish({ error: new ExtractionFailure("OCR_TIMEOUT") }),
        remainingMs,
      );
      execution.result.then(
        (value) => finish({ value }),
        (error) => finish({
          error: error instanceof ExtractionFailure
            ? error
            : new ExtractionFailure("OCR_ENGINE_FAILURE", undefined, error),
        }),
      );
    });
  }
}
