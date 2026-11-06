/**
 * CSV / TSV import — pure parsing and per-column typing.
 *
 * Faithful port of the loader in index.html. Two rules are load-bearing:
 *  - column type is decided PER COLUMN, never per cell (DESIGN §10.17), because
 *    `1011` is binary in a flags column and hex in an id column;
 *  - values are right-aligned into the register, zero-padded on the left, so a
 *    cell's numeric value is preserved and overflow truncates the high bits
 *    (DESIGN §10.16).
 */

export type ColumnMode = "bin" | "hex";

export interface Dataset {
  cols: string[];
  rows: string[][];
}

/** Minimal RFC4180 reader: quoted fields, doubled quotes, CRLF. */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const nl = t.indexOf("\n");
  const head = nl === -1 ? t : t.slice(0, nl);
  const tabs = (head.match(/\t/g) || []).length;
  const commas = (head.match(/,/g) || []).length;
  const delim = tabs > commas ? "\t" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const normCell = (raw: string | undefined | null): string =>
  String(raw ?? "").trim().replace(/[\s_]/g, "");

export const stripPrefix = (s: string): string => s.replace(/^0[xX]/, "").replace(/^0[bB]/, "");

export const isToken = (s: string): boolean => /^[0-9a-fA-F]+$/.test(stripPrefix(s));

/** All non-empty cells are token-shaped and at least one exists. */
export function isDataRow(cells: string[]): boolean {
  let any = false;
  for (const c of cells) {
    const s = normCell(c);
    if (!s) continue;
    if (!isToken(s)) return false;
    any = true;
  }
  return any;
}

/** All-0/1 column -> binary; anything with a bigger hex digit -> hex. */
export function columnMode(rows: string[][], ci: number): ColumnMode {
  let sawHex = false;
  let sawBin = false;
  for (const r of rows) {
    const s = stripPrefix(normCell(r[ci]));
    if (!s || !isToken(s)) continue;
    if (/^[01]+$/.test(s)) sawBin = true;
    else sawHex = true;
  }
  return sawHex ? "hex" : sawBin ? "bin" : "hex";
}

/** MSB-first bit array for one cell, or null when the cell is not valid. */
export function cellToBits(raw: string | undefined, mode: ColumnMode): number[] | null {
  const s = stripPrefix(normCell(raw));
  if (!s) return null;

  if (mode === "bin") {
    if (!/^[01]+$/.test(s)) return null;
    return s.split("").map(Number);
  }
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const out: number[] = [];
  for (const ch of s) {
    const v = parseInt(ch, 16);
    out.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
  }
  return out;
}

/**
 * Right-aligns an MSB-first bit array into an N-bit register (zero-pad left,
 * truncate high bits). This is index.html's `writeBitsInto` without the DOM.
 */
export function alignBits(arr: number[], N: number): Uint8Array {
  const bits = new Uint8Array(N);
  for (let k = 0; k < arr.length; k++) {
    const idx = arr.length - 1 - k;
    if (idx < N) bits[idx] = arr[k];
  }
  return bits;
}

export function cellToRegister(raw: string | undefined, mode: ColumnMode, N: number): Uint8Array | null {
  const arr = cellToBits(raw, mode);
  return arr ? alignBits(arr, N) : null;
}

export function columnWidth(rows: string[][], ci: number): number {
  if (ci < 0) return 0;
  const mode = columnMode(rows, ci);
  let max = 0;
  for (const r of rows) {
    const bits = cellToBits(r[ci], mode);
    if (bits && bits.length > max) max = bits.length;
  }
  return max;
}

/** Index of the WIDEST token column, not the first (DESIGN §10.21). */
export function widestColumn(rows: string[][]): number {
  let best = -1;
  let bestW = -1;
  for (let ci = 0; ci < (rows[0]?.length ?? 0); ci++) {
    const w = columnWidth(rows, ci);
    if (w > bestW) {
      bestW = w;
      best = ci;
    }
  }
  return bestW > 0 ? best : 0;
}

/**
 * Header detection + row filtering, as `loadCSV` does: drop fully empty rows;
 * a first row is a header when it is not a data row; fall back to colN names.
 */
export function parseDataset(text: string): Dataset | null {
  const rows = parseDelimited(text).filter((r) => r.some((c) => normCell(c) !== ""));
  if (rows.length < 1) return null;

  const hasHeader = !isDataRow(rows[0]);
  const cols = hasHeader
    ? rows[0].map((c, i) => String(c).trim() || `col${i + 1}`)
    : rows[0].map((_, i) => `col${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;
  if (!body.length) return null;

  return { cols, rows: body };
}
