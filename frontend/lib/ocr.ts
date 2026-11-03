/**
 * On-device OCR for order screenshots (BulkOrderSplit_Plan.md §3.0.1).
 *
 * Tesseract.js runs in a Web Worker on the phone. Only the TEXT goes to the server; the
 * image stays here unless the server asks for the vision backup.
 *
 * Layout matters more than raw text: an app screenshot puts the item name on the left and
 * its price on the right of the same row. We rebuild those rows from word boxes and join
 * columns with " | ", so the text model sees "Amul Taaza 1 L | 2 x | ₹54".
 */

import type Tesseract from "tesseract.js";

export interface OcrResult {
  /** Rows rebuilt from word positions — this is what the server receives. */
  text: string;
  /** Tesseract's mean word confidence, 0–100. */
  confidence: number;
  ms: number;
}

let schedulerPromise: Promise<Tesseract.Scheduler> | null = null;

/** Lazily start 1–2 workers (2 only on phones with cores to spare). Language data is cached by the browser. */
function getScheduler(): Promise<Tesseract.Scheduler> {
  if (!schedulerPromise) {
    schedulerPromise = (async () => {
      const T = await import("tesseract.js");
      const scheduler = T.createScheduler();
      const count = (navigator.hardwareConcurrency ?? 2) >= 6 ? 2 : 1;
      const workers = await Promise.all(
        Array.from({ length: count }, async () => {
          const w = await T.createWorker("eng", T.OEM.LSTM_ONLY);
          await w.setParameters({
            // App screens are scattered labels and right-aligned prices, not paragraphs.
            tessedit_pageseg_mode: T.PSM.SPARSE_TEXT,
            preserve_interword_spaces: "1",
          });
          return w;
        })
      );
      workers.forEach((w) => scheduler.addWorker(w));
      return scheduler;
    })().catch((err) => {
      schedulerPromise = null;
      throw err;
    });
  }
  return schedulerPromise;
}

/** Start downloading the OCR engine early (e.g. when the import screen opens). */
export function warmUpOcr(): void {
  getScheduler().catch(() => {});
}

/**
 * Prepare a screenshot for OCR: greyscale, invert dark-mode screens (Tesseract wants dark
 * text on light), and scale so text is big enough — but never past ~3000px wide.
 */
async function preprocess(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const targetW = Math.min(Math.max(bitmap.width, 1080), 1600);
  const scale = targetW / bitmap.width;
  // Very long scrolling screenshots: keep the canvas under browser limits.
  const h = Math.min(Math.round(bitmap.height * scale), 16000);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, targetW, h);
  bitmap.close?.();

  const img = ctx.getImageData(0, 0, targetW, h);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
    sum += y;
  }
  if (sum / (d.length / 4) < 110) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

interface WordBox {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Group words into visual rows by vertical overlap, then join columns.
 * A horizontal gap wider than ~2.5 character widths becomes " | ".
 */
export function rebuildRows(words: WordBox[]): string {
  const clean = words.filter((w) => w.text.trim().length > 0);
  if (clean.length === 0) return "";

  const heights = clean.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 10;

  const sorted = [...clean].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const rows: { yc: number; words: WordBox[] }[] = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const row = rows.length > 0 ? rows[rows.length - 1] : null;
    if (row && Math.abs(yc - row.yc) <= medianH * 0.55) {
      row.words.push(w);
      row.yc = (row.yc * (row.words.length - 1) + yc) / row.words.length;
    } else {
      rows.push({ yc, words: [w] });
    }
  }

  return rows
    .map((row) => {
      const ws = row.words.sort((a, b) => a.x0 - b.x0);
      let line = ws[0].text;
      for (let i = 1; i < ws.length; i++) {
        const prev = ws[i - 1];
        const charW = (prev.x1 - prev.x0) / Math.max(prev.text.length, 1);
        const gap = ws[i].x0 - prev.x1;
        line += gap > Math.max(charW * 2.5, medianH * 1.2) ? " | " : " ";
        line += ws[i].text;
      }
      return line;
    })
    .join("\n");
}

export async function ocrImage(file: Blob): Promise<OcrResult> {
  const started = performance.now();
  const [scheduler, canvas] = await Promise.all([getScheduler(), preprocess(file)]);
  const res = (await scheduler.addJob("recognize", canvas, {}, { blocks: true, text: true })) as Tesseract.RecognizeResult;
  const page = res.data;

  const words: WordBox[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          // Drop pure noise (icons read as "|", "©", "~")
          if (w.confidence < 25 && !/[0-9a-z]/i.test(w.text)) continue;
          words.push({ text: w.text, ...w.bbox });
        }
      }
    }
  }

  const text = words.length > 0 ? rebuildRows(words) : page.text;
  return { text, confidence: Math.round(page.confidence ?? 0), ms: Math.round(performance.now() - started) };
}
