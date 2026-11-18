import { join } from "node:path";

import { ExtractionFailure } from "./errors";
import type { DirectPdfPage, PdfExtractionAdapter, PdfExtractionSession } from "./types";

interface PdfTextItem {
  str?: unknown;
  hasEOL?: unknown;
}

function pageText(items: unknown[]): string {
  return items.map((item) => {
    const candidate = item as PdfTextItem;
    return typeof candidate.str === "string" ? `${candidate.str}${candidate.hasEOL ? "\n" : " "}` : "";
  }).join("");
}

export async function collectBoundedPdfText(
  stream: ReadableStream<{ items: unknown[] }>,
  maxRawCharacters: number,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  let characterCount = 0;
  let completed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        completed = true;
        return chunks.join("");
      }
      const chunk = pageText(next.value.items);
      characterCount += Array.from(chunk).length;
      if (characterCount > maxRawCharacters) {
        throw new ExtractionFailure("RAW_TEXT_LIMIT_EXCEEDED");
      }
      chunks.push(chunk);
    }
  } finally {
    if (!completed) {
      void reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

async function destroyWithin(resource: { destroy(): Promise<void> }, timeoutMs: number): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.resolve().then(() => resource.destroy()).catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
}

export async function acquirePdfDocument<T>(
  loadingTask: { promise: Promise<T>; destroy(): Promise<void> },
  cleanupTimeoutMs: number,
): Promise<T> {
  try {
    return await loadingTask.promise;
  } catch (error) {
    await destroyWithin(loadingTask, cleanupTimeoutMs);
    throw error;
  }
}

const ISOLATED_PDF_TIMEOUT_MS = 60_000;
const ISOLATED_PDF_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ISOLATED_PDF_MAX_DIAGNOSTIC_BYTES = 4 * 1024;
const ISOLATED_PDF_MAX_CHARS_PER_PAGE = 1_000_000;

export function isIsolatedPdfDirectTextEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.PDF_DIRECT_TEXT_SUBPROCESS?.trim().toLowerCase() === "true";
}

function parserFailureCode(message: string): "MALFORMED_PDF" | "DIRECT_PARSER_FAILURE" {
  const normalized = message.toLowerCase();
  return normalized.includes("invalid pdf") || normalized.includes("missing pdf")
    ? "MALFORMED_PDF"
    : "DIRECT_PARSER_FAILURE";
}

type IsolatedPdfText = { pageCount: number; pages: { text: string; overLimit: boolean }[] };

const NODE_LOADER_OPTIONS = new Set(["--import", "--loader", "--experimental-loader", "--require", "-r"]);

function childEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const tokens = (environment.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean);
  const nodeOptions: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (NODE_LOADER_OPTIONS.has(token)) {
      const loader = tokens[index + 1];
      if (loader?.toLowerCase().includes("tsx")) {
        index += 1;
        continue;
      }
    }
    if (
      [...NODE_LOADER_OPTIONS].some((option) => token.startsWith(`${option}=`))
      && token.toLowerCase().includes("tsx")
    ) {
      continue;
    }
    nodeOptions.push(token);
  }
  return { ...environment, NODE_OPTIONS: nodeOptions.join(" ") };
}

function sanitizedParserFailureMessage(input: {
  stderr?: string;
  message?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}): string {
  const diagnostic = `${input.stderr ?? ""}\n${input.message ?? ""}`.toLowerCase();
  if (/err_module_not_found|cannot find (?:module|package)|module_not_found/.test(diagnostic)) {
    return "Lo script o una dipendenza del parser PDF non è disponibile.";
  }
  if (/out of memory|enomem|allocation failed/.test(diagnostic) || input.signal === "SIGKILL") {
    return "Il parser PDF è stato terminato per esaurimento di memoria.";
  }
  if (input.signal) {
    return "Il processo del parser PDF è stato terminato inaspettatamente.";
  }
  if (typeof input.exitCode === "number" && input.exitCode !== 0) {
    return `Il processo del parser PDF è terminato con codice ${input.exitCode}.`;
  }
  return "Il parser PDF ha restituito una risposta tecnica non valida.";
}

/**
 * Reads PDF direct text in a plain Node child process. Under the tsx loader, pdf.js uses
 * ~450 MB instead of ~90 MB, which gets 512 MB worker instances killed without logs.
 */
export async function readPdfDirectTextIsolated(
  bytes: Buffer,
  maxPages: number,
  scriptPath = join(process.cwd(), "scripts", "runtime", "pdf-direct-text.mjs"),
): Promise<IsolatedPdfText> {
  const { spawn } = await import("node:child_process");
  const subprocessResult = await new Promise<{
    output: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath, String(maxPages), String(ISOLATED_PDF_MAX_CHARS_PER_PAGE)],
      { cwd: process.cwd(), env: childEnvironment(), stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    const diagnosticChunks: Buffer[] = [];
    let size = 0;
    let diagnosticSize = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ExtractionFailure(
        "DIRECT_PARSER_FAILURE",
        "Il parser PDF non ha risposto entro il limite di tempo.",
      ));
    }, ISOLATED_PDF_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > ISOLATED_PDF_MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new ExtractionFailure("TEXT_PAYLOAD_LIMIT_EXCEEDED"));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (diagnosticSize >= ISOLATED_PDF_MAX_DIAGNOSTIC_BYTES) return;
      const boundedChunk = chunk.subarray(0, ISOLATED_PDF_MAX_DIAGNOSTIC_BYTES - diagnosticSize);
      diagnosticSize += boundedChunk.length;
      diagnosticChunks.push(boundedChunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      const message = error.code === "ENOENT"
        ? "Il runtime del parser PDF non è disponibile."
        : "Il processo del parser PDF non è stato avviato.";
      reject(new ExtractionFailure("DIRECT_PARSER_FAILURE", message));
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        stderr: Buffer.concat(diagnosticChunks).toString("utf8"),
        exitCode,
        signal,
      });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(bytes);
  });
  if (subprocessResult.exitCode !== 0 || subprocessResult.signal !== null) {
    throw new ExtractionFailure(
      "DIRECT_PARSER_FAILURE",
      sanitizedParserFailureMessage(subprocessResult),
    );
  }
  let parsed: { ok?: unknown; code?: unknown; message?: unknown; pageCount?: unknown; pages?: unknown };
  try {
    parsed = JSON.parse(subprocessResult.output.trim().split("\n").at(-1) ?? "");
  } catch {
    throw new ExtractionFailure(
      "DIRECT_PARSER_FAILURE",
      sanitizedParserFailureMessage(subprocessResult),
    );
  }
  if (parsed.ok !== true) {
    if (parsed.code === "PAGE_LIMIT_EXCEEDED") throw new ExtractionFailure("PAGE_LIMIT_EXCEEDED");
    const message = typeof parsed.message === "string" ? parsed.message : "";
    throw new ExtractionFailure(
      parserFailureCode(message),
      sanitizedParserFailureMessage({ ...subprocessResult, message }),
    );
  }
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  if (
    typeof parsed.pageCount !== "number"
    || pages.length !== parsed.pageCount
    || !pages.every((page) => typeof page?.text === "string" && typeof page?.overLimit === "boolean")
  ) {
    throw new ExtractionFailure("DIRECT_PARSER_FAILURE");
  }
  return { pageCount: parsed.pageCount, pages };
}

export class PdfJsExtractionAdapter implements PdfExtractionAdapter {
  readonly name = "pdfjs-dist";
  readonly version = "5.4.149";
  readonly rasterizerName = "@napi-rs/canvas";
  readonly rasterizerVersion = "0.1.80";

  constructor(private readonly options: Readonly<{
    isolatedDirectText?: boolean;
    loadPdfJs?: () => Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>;
  }> = {}) {}

  async open(bytes: Buffer, maxPages: number): Promise<PdfExtractionSession> {
    if (this.options.isolatedDirectText ?? isIsolatedPdfDirectTextEnabled()) {
      return this.openIsolated(bytes, maxPages);
    }
    return this.openInProcess(bytes, maxPages);
  }

  private async openIsolated(bytes: Buffer, maxPages: number): Promise<PdfExtractionSession> {
    const isolated = await readPdfDirectTextIsolated(bytes, maxPages);
    let renderer: Promise<PdfExtractionSession> | null = null;
    return {
      pageCount: isolated.pageCount,
      pages: isolated.pages.map((page, index) => ({
        pageNumber: index + 1,
        readText: async (maxRawCharacters) => {
          if (page.overLimit || Array.from(page.text).length > maxRawCharacters) {
            throw new ExtractionFailure("RAW_TEXT_LIMIT_EXCEEDED");
          }
          return page.text;
        },
      })),
      // OCR rasterization is rare in direct-text workers; load pdf.js in-process only when needed.
      renderPage: async (pageNumber, maxPixels) => {
        renderer ??= this.openInProcess(bytes, maxPages);
        return (await renderer).renderPage(pageNumber, maxPixels);
      },
      close: async (timeoutMs) => {
        if (!renderer) return;
        try {
          await (await renderer).close(timeoutMs);
        } catch (_closeError) {}
      },
    };
  }

  private async openInProcess(bytes: Buffer, maxPages: number): Promise<PdfExtractionSession> {
    try {
      const pdfjs = await (this.options.loadPdfJs
        ? this.options.loadPdfJs()
        : import("pdfjs-dist/legacy/build/pdf.mjs"));
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: true,
      });
      const document = await acquirePdfDocument(loadingTask, 5_000);
      if (document.numPages > maxPages) {
        await destroyWithin(document, 5_000);
        throw new ExtractionFailure("PAGE_LIMIT_EXCEEDED");
      }

      const pages: DirectPdfPage[] = Array.from({ length: document.numPages }, (_, index) => ({
        pageNumber: index + 1,
        readText: async (maxRawCharacters) => {
          const page = await document.getPage(index + 1);
          try {
            return await collectBoundedPdfText(
              page.streamTextContent({ disableNormalization: true }),
              maxRawCharacters,
            );
          } finally {
            try { page.cleanup(); } catch (_cleanupError) {}
          }
        },
      }));

      return {
        pageCount: document.numPages,
        pages,
        renderPage: async (pageNumber, maxPixels) => {
          let page;
          try {
            const { createCanvas } = await import("@napi-rs/canvas");
            page = await document.getPage(pageNumber);
            const unscaled = page.getViewport({ scale: 1 });
            const targetWidth = Math.max(1, Math.ceil(unscaled.width * 2));
            const targetHeight = Math.max(1, Math.ceil(unscaled.height * 2));
            if (targetWidth * targetHeight > maxPixels) {
              throw new ExtractionFailure("IMAGE_PIXEL_LIMIT_EXCEEDED");
            }
            const viewport = page.getViewport({ scale: 2 });
            const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext("2d");
            await page.render({ canvas: canvas as never, canvasContext: context as never, viewport }).promise;
            const rendered = canvas.toBuffer("image/png");
            return rendered;
          } catch (error) {
            if (error instanceof ExtractionFailure) {
              throw error;
            }
            throw new ExtractionFailure("RASTERIZATION_FAILURE", undefined, error);
          } finally {
            if (page) {
              try { page.cleanup(); } catch (_cleanupError) {}
            }
          }
        },
        close: (timeoutMs) => destroyWithin(document, timeoutMs),
      };
    } catch (error) {
      if (error instanceof ExtractionFailure) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      throw new ExtractionFailure(
        parserFailureCode(message),
        sanitizedParserFailureMessage({ message }),
        error,
      );
    }
  }
}
