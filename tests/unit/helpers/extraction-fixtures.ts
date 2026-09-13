import { createCanvas } from "@napi-rs/canvas";
import PDFDocument from "pdfkit";

export function createTextImage(format: "png" | "jpeg", text: string): Buffer {
  const canvas = createCanvas(1200, 220);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.font = "bold 52px sans-serif";
  context.fillText(text, 24, 125);
  return format === "png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", 95);
}

export async function createPdf(
  pages: ReadonlyArray<{ type: "text"; text: string } | { type: "image"; image: Buffer }>,
): Promise<Buffer> {
  const document = new PDFDocument({ autoFirstPage: false, compress: false });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  for (const page of pages) {
    document.addPage({ size: "A4", margin: 40 });
    if (page.type === "text") {
      document.fontSize(18).text(page.text);
    } else {
      document.image(page.image, 40, 100, { fit: [515, 300] });
    }
  }
  document.end();
  return completed;
}
