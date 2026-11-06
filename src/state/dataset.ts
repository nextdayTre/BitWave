/**
 * Dataset state — the imported CSV/TSV columns, rows and current step.
 *
 * DOM-free; the app's import/typing/render logic stays in main.js until the
 * io/ layer is split. Kept here so the renderers can read column names.
 */

export interface DatasetState {
  cols: string[];
  rows: string[][];
  i: number;
}

export const DEMO: DatasetState = { cols: [], rows: [], i: 0 };
