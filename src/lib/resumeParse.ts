/**
 * resumeParse.ts
 * -----------------------------------------------------------------------
 * Everything here runs entirely in the browser. A resume is never
 * uploaded anywhere — it's read into memory, parsed, and thrown away
 * the moment the person navigates elsewhere or closes the tab. Nothing
 * from it is signed or published except the specific entries the
 * person explicitly approves, one at a time, on the review screen.
 *
 * This is keyword-based, not AI-based — there's no model doing semantic
 * understanding here, just pattern matching. It WILL miss things and
 * WILL occasionally misjudge things. That's fine, because it never gets
 * the final word: every entry lands in front of the person for review,
 * and the classifier's job is only to sort entries into three buckets
 * with a strong conservative bias:
 *
 *   "event"      — confident match on a specific event-industry keyword.
 *                  Pre-filled and ready to review, NOT auto-published.
 *   "ambiguous"  — some weak signal, not enough to be confident. Never
 *                  shown as a ready-to-publish credit — the person is
 *                  asked directly "is this an event, or not?" before
 *                  it becomes a draft credit at all.
 *   "non-event"  — no event-industry signal found. Excluded by default,
 *                  never shown as a credit candidate. Collapsed behind
 *                  an explicit "show what was excluded" toggle so the
 *                  person can catch a false negative, but nothing here
 *                  is ever pre-selected for publishing.
 * -----------------------------------------------------------------------
 */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// @ts-ignore -- Vite's ?url suffix resolves to the built asset path; no types needed for that.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { extractRawText } from "mammoth";
import type { CreditContent, EventType } from "./schema";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "pdf") return extractTextFromPdf(file);
  if (ext === "docx") return extractTextFromDocx(file);
  if (ext === "txt" || ext === "md") return file.text();
  throw new Error("Unsupported file type — upload a .pdf, .docx, or .txt resume.");
}

async function extractTextFromPdf(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => ("str" in item ? item.str : "")).join(" ");
    text += pageText + "\n";
  }
  return text;
}

async function extractTextFromDocx(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const result = await extractRawText({ arrayBuffer: buf });
  return result.value;
}

// --- Section detection: only look for work-history entries between an
// "experience"-like header and the next unrelated section, if we can
// find one. If we can't confidently find section boundaries, we fall
// back to scanning the whole document — better to over-ask than to
// silently miss real event credits.
const SECTION_START_HEADERS = [
  "work experience",
  "professional experience",
  "experience",
  "employment history",
  "employment",
  "work history",
  "relevant experience",
];
const SECTION_END_HEADERS = ["education", "skills", "certifications", "certificates", "awards", "references", "publications", "languages", "interests"];

function extractExperienceSection(text: string): string {
  const lines = text.split(/\r?\n/);
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const norm = lines[i].trim().toLowerCase().replace(/[^a-z ]/g, "");
    if (startIdx === -1 && SECTION_START_HEADERS.includes(norm)) {
      startIdx = i + 1;
      continue;
    }
    if (startIdx !== -1 && SECTION_END_HEADERS.includes(norm)) {
      endIdx = i;
      break;
    }
  }
  if (startIdx === -1) return text; // no clear section header found — scan everything
  return lines.slice(startIdx, endIdx).join("\n");
}

// --- Segmentation: resumes reliably anchor each job to a date range
// far more often than they use consistent formatting otherwise, so we
// split on date-range occurrences rather than trying to parse layout.
const DATE_RANGE_RE = /\b(19|20)\d{2}\b(\s*[-–—to]{1,4}\s*(\b(19|20)\d{2}\b|present|current))?/gi;
const MAX_ENTRIES = 40;

function segmentIntoBlocks(text: string): string[] {
  const matches = [...text.matchAll(DATE_RANGE_RE)];
  if (matches.length === 0) {
    return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_ENTRIES);
  }
  const segments: string[] = [];
  for (let i = 0; i < matches.length && segments.length < MAX_ENTRIES; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const seg = text.slice(start, end).trim();
    if (seg.length > 8) segments.push(seg);
  }
  return segments;
}

// --- Classification keyword sets. Deliberately specific — generic
// words like "manager," "coordinator," or "event" alone are treated as
// weak signal, not enough on their own to call something event work.
const EVENT_TYPE_KEYWORDS: [string, EventType][] = [
  ["music festival", "Music Festival"],
  ["festival", "Music Festival"],
  ["concert tour", "Music Festival"],
  ["tour", "Music Festival"],
  ["conference", "Conference"],
  ["summit", "Conference"],
  ["convention", "Conference"],
  ["trade show", "Conference"],
  ["expo", "Conference"],
  ["tournament", "Sporting Event"],
  ["championship", "Sporting Event"],
  ["marathon", "Sporting Event"],
  ["game day", "Sporting Event"],
  ["gameday", "Sporting Event"],
  ["match day", "Sporting Event"],
  ["gala", "Corporate Event"],
  ["awards ceremony", "Corporate Event"],
  ["product launch", "Corporate Event"],
  ["theater production", "Theater / Live Show"],
  ["theatre production", "Theater / Live Show"],
  ["live show", "Theater / Live Show"],
  ["concert", "Theater / Live Show"],
];

const EVENT_ROLE_KEYWORDS = [
  "stage manager",
  "stagehand",
  "rigger",
  "foh engineer",
  "front of house",
  "monitor engineer",
  "av tech",
  "audio engineer",
  "lighting designer",
  "lighting technician",
  "production manager",
  "production assistant",
  "tour manager",
  "credentialing",
  "box office",
  "ticketing",
  "event security",
  "volunteer coordinator",
  "site operations",
  "crew chief",
  "backstage",
  "talent buyer",
  "run of show",
  "load-in",
  "load in",
  "load-out",
  "load out",
  "gaffer",
  "broadcast engineer",
  "guest services",
  "credential",
];

const VENUE_KEYWORDS = ["arena", "stadium", "amphitheater", "amphitheatre", "fairgrounds", "convention center", "venue"];
const WEAK_KEYWORDS = ["event", "events", "coordinator", "operations staff"];

export type Classification = "event" | "ambiguous" | "non-event";

export function classifyEntry(text: string): { classification: Classification; matchedKeywords: string[]; suggestedType: EventType | null } {
  const norm = text.toLowerCase();

  const typeHits = EVENT_TYPE_KEYWORDS.filter(([kw]) => norm.includes(kw));
  const roleHits = EVENT_ROLE_KEYWORDS.filter((kw) => norm.includes(kw));
  const venueHits = VENUE_KEYWORDS.filter((kw) => norm.includes(kw));
  const weakHits = WEAK_KEYWORDS.filter((kw) => norm.includes(kw));

  const strongMatches = [...typeHits.map(([kw]) => kw), ...roleHits];
  const suggestedType = typeHits[0]?.[1] ?? null;

  if (strongMatches.length > 0) {
    return { classification: "event", matchedKeywords: strongMatches, suggestedType };
  }
  if (venueHits.length > 0 || weakHits.length > 0) {
    return { classification: "ambiguous", matchedKeywords: [...venueHits, ...weakHits], suggestedType: null };
  }
  return { classification: "non-event", matchedKeywords: [], suggestedType: null };
}

export interface ParsedEntry {
  id: string;
  rawText: string;
  classification: Classification;
  matchedKeywords: string[];
  guess: {
    eventName: string;
    role: string;
    eventType: EventType;
    year: number | null;
    endYear: number | null;
    description: string;
  };
}

function guessYearRange(text: string): { year: number | null; endYear: number | null } {
  const match = text.match(DATE_RANGE_RE);
  if (!match) return { year: null, endYear: null };
  const years = [...match[0].matchAll(/\b(19|20)\d{2}\b/g)].map((m) => parseInt(m[0], 10));
  const isOngoing = /present|current/i.test(match[0]);
  return {
    year: years[0] ?? null,
    endYear: isOngoing ? null : years[1] ?? null,
  };
}

function guessRoleAndEventName(text: string): { role: string; eventName: string } {
  // Strip the date-range token, then look at the first substantive line for
  // a "Role at/@/, / — Employer" pattern. Falls back to leaving eventName as
  // the first line and role blank — always editable on the review screen.
  const withoutDate = text.replace(DATE_RANGE_RE, "").trim();
  const firstLine = withoutDate.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 2) ?? "";
  const sepMatch = firstLine.match(/^(.+?)\s*(?:@|—|-|,|\bat\b)\s*(.+)$/i);
  if (sepMatch) {
    return { role: sepMatch[1].trim(), eventName: sepMatch[2].trim() };
  }
  return { role: "", eventName: firstLine.slice(0, 80) };
}

function guessDescription(text: string): string {
  const withoutDate = text.replace(DATE_RANGE_RE, "").trim();
  const lines = withoutDate.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const body = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
  return body.length > 300 ? body.slice(0, 297) + "…" : body;
}

/** Parse raw resume text into candidate entries — the main entry point the UI calls. */
export function parseResumeIntoEntries(fullText: string): ParsedEntry[] {
  const section = extractExperienceSection(fullText);
  const blocks = segmentIntoBlocks(section);

  return blocks.map((block, i) => {
    const { classification, matchedKeywords, suggestedType } = classifyEntry(block);
    const { year, endYear } = guessYearRange(block);
    const { role, eventName } = guessRoleAndEventName(block);
    return {
      id: `entry-${i}`,
      rawText: block,
      classification,
      matchedKeywords,
      guess: {
        eventName,
        role,
        eventType: suggestedType ?? "Other",
        year,
        endYear,
        description: guessDescription(block),
      },
    };
  });
}

/** Turn an approved (and possibly hand-edited) entry into a real CreditContent, ready to sign. */
export function entryToCreditContent(entry: ParsedEntry): CreditContent {
  const currentYear = new Date().getFullYear();
  return {
    eventName: entry.guess.eventName || "Untitled event",
    role: entry.guess.role || "Crew",
    eventType: entry.guess.eventType,
    year: entry.guess.year ?? currentYear,
    endYear: entry.guess.endYear,
    description: entry.guess.description || undefined,
  };
}
