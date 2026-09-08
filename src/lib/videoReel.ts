/**
 * videoReel.ts
 * -----------------------------------------------------------------------
 * Renders a movie-style scrolling credits roll onto a canvas and
 * captures it as a real downloadable video, entirely in the browser —
 * no server, no upload, nothing leaves the device except the file the
 * person chooses to download.
 *
 * Approach: draw the whole roll once onto a tall offscreen canvas
 * (so text layout only happens once, not every frame), then each
 * animation frame blits a moving window of that offscreen canvas onto
 * the visible canvas — cheap, smooth, and simple to reason about.
 *
 * Output is .webm (via MediaRecorder), not .mp4. Getting real .mp4 out
 * of a browser means shipping an ffmpeg build compiled to WebAssembly
 * (~25MB+) and usually needs special cross-origin-isolation headers
 * that a plain static host like GitHub Pages doesn't set by default.
 * .webm plays fine on most platforms; where it doesn't, a free online
 * converter is one extra step. Worth revisiting if that trade-off ever
 * stops being acceptable — see the README roadmap note.
 * -----------------------------------------------------------------------
 */

import type { ResolvedCredit } from "./directory";

export type ReelFormat = "vertical" | "square";

const FORMATS: Record<ReelFormat, { width: number; height: number }> = {
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

const MAX_CREDITS_IN_REEL = 60;
const SCROLL_SPEED_PX_PER_SEC = 140;
const MIN_DURATION_MS = 8000;
const MAX_DURATION_MS = 70000;
const FPS = 30;

const COLORS = {
  background: "#16181C",
  accent: "#4FA3A3",
  name: "#F7F5F0",
  title: "#D6D2C4",
  heading: "#E2963A",
  eventText: "#F0EFEA",
  metaText: "#9A9DA4",
  footer: "#7A7D82",
};

interface Line {
  text: string;
  font: string;
  color: string;
  gapAfter: number; // px of empty space to leave after this line
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface ReelInput {
  name: string;
  title?: string;
  credits: ResolvedCredit[];
}

/** Draw the entire credits roll once onto a tall offscreen canvas, returning it plus the vertical distance the visible frame needs to scroll through to show all of it (start to finish, blank-to-blank). */
export async function buildReel(input: ReelInput, format: ReelFormat): Promise<{ canvas: HTMLCanvasElement; scrollDistance: number; durationMs: number }> {
  const { width, height } = FORMATS[format];
  const margin = width * 0.1;
  const maxTextWidth = width - margin * 2;

  const nameFont = `700 ${Math.round(width * 0.085)}px "Barlow Condensed", sans-serif`;
  const titleFont = `400 ${Math.round(width * 0.042)}px "Source Sans 3", sans-serif`;
  const headingFont = `600 ${Math.round(width * 0.055)}px "Barlow Condensed", sans-serif`;
  const eventFont = `600 ${Math.round(width * 0.044)}px "Source Sans 3", sans-serif`;
  const metaFont = `400 ${Math.round(width * 0.03)}px "Source Sans 3", sans-serif`;
  const footerFont = `400 ${Math.round(width * 0.028)}px "Source Sans 3", sans-serif`;

  // Explicitly load each font variant we're about to draw with — document.fonts.ready
  // alone can resolve before a not-yet-used font starts loading at all, which would
  // silently fall back to a system font in the recorded video.
  await Promise.all(
    [nameFont, titleFont, headingFont, eventFont, metaFont, footerFont].map((f) => document.fonts.load(f))
  );

  // Measure pass: figure out every line and the total content height first.
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d")!;

  const lines: Line[] = [];

  mctx.font = nameFont;
  wrapText(mctx, input.name.toUpperCase(), maxTextWidth).forEach((l) =>
    lines.push({ text: l, font: nameFont, color: COLORS.name, gapAfter: width * 0.02 })
  );

  if (input.title) {
    mctx.font = titleFont;
    wrapText(mctx, input.title, maxTextWidth).forEach((l) =>
      lines.push({ text: l, font: titleFont, color: COLORS.title, gapAfter: width * 0.02 })
    );
  }
  lines[lines.length - 1].gapAfter = width * 0.12;

  lines.push({ text: "CREDITS", font: headingFont, color: COLORS.heading, gapAfter: width * 0.08 });

  const capped = input.credits.slice(0, MAX_CREDITS_IN_REEL);
  capped.forEach((c) => {
    mctx.font = eventFont;
    wrapText(mctx, c.content.eventName, maxTextWidth).forEach((l, i) =>
      lines.push({ text: l, font: eventFont, color: COLORS.eventText, gapAfter: i === 0 ? width * 0.008 : width * 0.008 })
    );
    const yearLabel = c.content.endYear ? `${c.content.year}–${c.content.endYear}` : `${c.content.year}`;
    lines.push({
      text: `${c.content.role} · ${c.content.eventType} · ${yearLabel}`,
      font: metaFont,
      color: COLORS.metaText,
      gapAfter: width * 0.05,
    });
  });

  lines.push({ text: "", font: footerFont, color: COLORS.footer, gapAfter: width * 0.06 });
  lines.push({ text: "Made with Laminate", font: footerFont, color: COLORS.footer, gapAfter: 0 });

  // Compute total content height by measuring line height per font.
  let contentHeight = 0;
  const lineHeights: number[] = lines.map((l) => {
    mctx.font = l.font;
    const metrics = mctx.measureText("Mg");
    const h = (metrics.fontBoundingBoxAscent ?? width * 0.05) + (metrics.fontBoundingBoxDescent ?? width * 0.01);
    return h + l.gapAfter;
  });
  contentHeight = lineHeights.reduce((a, b) => a + b, 0);

  const topPad = height;
  const bottomPad = height;
  const totalHeight = Math.ceil(topPad + contentHeight + bottomPad);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, totalHeight);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  let y = topPad;
  lines.forEach((l, i) => {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    y += (lineHeights[i] - l.gapAfter) * 0.8; // advance to this line's baseline
    if (l.text) ctx.fillText(l.text, width / 2, y);
    y += lineHeights[i] * 0.2 + l.gapAfter;
  });

  const scrollDistance = totalHeight - height;
  const durationMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, (scrollDistance / SCROLL_SPEED_PX_PER_SEC) * 1000));

  return { canvas, scrollDistance, durationMs };
}

function pickSupportedMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

/**
 * Play the offscreen reel through a visible canvas while recording it,
 * calling `onProgress` (0–1) as it plays. Resolves with the recorded
 * video as a Blob once the whole roll has scrolled through.
 */
export async function recordReel(
  visibleCanvas: HTMLCanvasElement,
  offscreenCanvas: HTMLCanvasElement,
  scrollDistance: number,
  durationMs: number,
  format: ReelFormat,
  onProgress: (t: number) => void
): Promise<Blob> {
  const { width, height } = FORMATS[format];
  visibleCanvas.width = width;
  visibleCanvas.height = height;
  const ctx = visibleCanvas.getContext("2d")!;

  const stream = visibleCanvas.captureStream(FPS);
  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_500_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();

  await new Promise<void>((resolve) => {
    const start = performance.now();
    function frame(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / durationMs, 1);
      const scrollY = t * scrollDistance;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(offscreenCanvas, 0, scrollY, width, height, 0, 0, width, height);
      onProgress(t);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });

  recorder.stop();
  return stopped;
}

export function getFormatDimensions(format: ReelFormat) {
  return FORMATS[format];
}

export const REEL_CREDIT_CAP = MAX_CREDITS_IN_REEL;
