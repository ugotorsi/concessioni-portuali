export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined | Date;
}

function escapeCsvCell(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function normalizeCell(value: string | number | boolean | null | undefined | Date): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows.map((row) => {
    return columns
      .map((column) => escapeCsvCell(normalizeCell(column.value(row))))
      .join(",");
  });

  return [header, ...body].join("\n");
}

export function buildCsvFilename(prefix: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  return `${prefix}-${yyyy}${mm}${dd}-${hh}${mi}.csv`;
}

export function csvResponse(content: string, filename: string): Response {
  return new Response(content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
