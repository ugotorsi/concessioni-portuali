// Plain-Node PDF direct-text reader. It runs outside the tsx loader hooks, which multiply
// pdf.js memory usage and exhaust small worker instances. Input: PDF bytes on stdin.
// Output: one JSON line on stdout.
const maxPages = Number(process.argv[2]);
const maxCharsPerPage = Number(process.argv[3]);

// pdf.js logs warnings through console; keep stdout reserved for the JSON result.
console.log = () => undefined;
console.info = () => undefined;
console.warn = () => undefined;

function pageText(items) {
  return items.map((item) => (typeof item?.str === "string" ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")).join("");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readPage(document, pageNumber) {
  const page = await document.getPage(pageNumber);
  try {
    const reader = page.streamTextContent({ disableNormalization: true }).getReader();
    const chunks = [];
    let count = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) return { text: chunks.join(""), overLimit: false };
      const chunk = pageText(next.value.items);
      count += Array.from(chunk).length;
      if (count > maxCharsPerPage) {
        void reader.cancel().catch(() => undefined);
        return { text: "", overLimit: true };
      }
      chunks.push(chunk);
    }
  } finally {
    try { page.cleanup(); } catch {}
  }
}

async function main() {
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxCharsPerPage) || maxCharsPerPage < 1) {
    return { ok: false, code: "DIRECT_PARSER_FAILURE", message: "invalid arguments" };
  }
  const bytes = await readStdin();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let document;
  try {
    document = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true }).promise;
  } catch (error) {
    return { ok: false, code: null, message: error instanceof Error ? error.message : "" };
  }
  try {
    if (document.numPages > maxPages) return { ok: false, code: "PAGE_LIMIT_EXCEEDED", message: "" };
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await readPage(document, pageNumber));
    }
    return { ok: true, pageCount: document.numPages, pages };
  } finally {
    await document.destroy().catch(() => undefined);
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => process.stdout.write(`${JSON.stringify({ ok: false, code: null, message: error instanceof Error ? error.message : "" })}\n`));
