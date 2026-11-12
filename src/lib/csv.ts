/** One CSV cell: quoted when needed, and spreadsheet formulas neutralised (= + - @ run in Excel). */
function cell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds a CSV (with a BOM so Excel reads UTF-8) and downloads it in the browser. */
export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const body = "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
