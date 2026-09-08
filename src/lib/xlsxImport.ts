/**
 * xlsxImport.ts
 * -----------------------------------------------------------------------
 * Turns an organizer's staff-list spreadsheet into a batch of
 * CREDENTIAL_OFFER rows. Only ever reads the file client-side — it
 * never leaves the browser except as the individual signed offers the
 * organizer explicitly chooses to publish afterward.
 * -----------------------------------------------------------------------
 */

import { readSheet } from "read-excel-file/browser";
import type { CredentialOfferContent, EventType } from "./schema";

export const EVENT_TYPES: EventType[] = [
  "Music Festival",
  "Conference",
  "Sporting Event",
  "Corporate Event",
  "Theater / Live Show",
  "Other",
];

export type MappableField = "recipientLabel" | "eventName" | "role" | "eventType" | "year" | "endYear" | "claimCode";

export const FIELD_LABELS: Record<MappableField, string> = {
  recipientLabel: "Recipient (name/email)",
  eventName: "Event name",
  role: "Role",
  eventType: "Event type",
  year: "Year",
  endYear: "End year",
  claimCode: "Claim code",
};

/** Keyword guesses used to auto-match spreadsheet headers to fields. Checked as exact matches first, then substring matches. */
const FIELD_SYNONYMS: Record<MappableField, string[]> = {
  recipientLabel: ["recipient", "name", "full name", "staff name", "email", "worker", "staff", "employee"],
  eventName: ["event", "event name", "festival", "conference", "show"],
  role: ["role", "position", "title", "job", "job title"],
  eventType: ["type", "event type", "category"],
  year: ["year", "start year"],
  endYear: ["end year", "through", "to year"],
  claimCode: ["claim code", "claimcode", "code", "invite code"],
};

export type ColumnMapping = Record<MappableField, number | null>;

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

/** Read the first sheet of an uploaded .xlsx file as a plain header row + string rows — no schema, so we can do our own interactive mapping. */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const data = await readSheet(file);
  if (data.length === 0) {
    return { headers: [], rows: [] };
  }
  const [headerRow, ...rest] = data;
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  const rows = rest
    .filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row) => headers.map((_, i) => String(row[i] ?? "").trim()));
  return { headers, rows };
}

/** Best-effort auto-match of spreadsheet headers to the fields we need, so the organizer usually doesn't have to map anything by hand. */
export function guessColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  const mapping = {} as ColumnMapping;

  (Object.keys(FIELD_SYNONYMS) as MappableField[]).forEach((field) => {
    const synonyms = FIELD_SYNONYMS[field];
    let found: number | null = null;
    for (const syn of synonyms) {
      const idx = normalized.findIndex((h) => h === syn);
      if (idx !== -1) { found = idx; break; }
    }
    if (found === null) {
      for (const syn of synonyms) {
        const idx = normalized.findIndex((h) => h.includes(syn));
        if (idx !== -1) { found = idx; break; }
      }
    }
    mapping[field] = found;
  });

  return mapping;
}

/** Match a spreadsheet's free-text event type to one of our known categories, falling back to "Other" rather than rejecting the row. */
export function normalizeEventType(raw: string): EventType {
  const norm = raw.toLowerCase().trim();
  const exact = EVENT_TYPES.find((t) => t.toLowerCase() === norm);
  if (exact) return exact;
  const partial = EVENT_TYPES.find((t) => norm.includes(t.toLowerCase().split(" ")[0]));
  return partial ?? "Other";
}

function slugify(s: string): string {
  const clean = s.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
  return clean || "X";
}

function autoClaimCode(eventName: string, recipientLabel: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${slugify(eventName)}-${slugify(recipientLabel)}-${rand}`;
}

export type DescriptionFormat = "lines" | "comma" | "none";

function buildDescription(headers: string[], row: string[], usedIndices: Set<number>, format: DescriptionFormat): string {
  if (format === "none") return "";
  const extras: [string, string][] = [];
  headers.forEach((h, i) => {
    if (!usedIndices.has(i) && row[i]) extras.push([h, row[i]]);
  });
  if (extras.length === 0) return "";
  if (format === "comma") {
    return extras.map(([h, v]) => `${h}: ${v}`).join(", ");
  }
  return extras.map(([h, v]) => `${h}: ${v}`).join("\n");
}

export interface BuiltOffer {
  content: CredentialOfferContent;
  skipped: boolean;
  skipReason?: string;
}

/** Turn every parsed row into a CredentialOfferContent, using the confirmed column mapping. Rows missing a required field (event name or role) are marked skipped rather than silently dropped. */
export function buildOffers(
  sheet: ParsedSheet,
  mapping: ColumnMapping,
  descriptionFormat: DescriptionFormat
): BuiltOffer[] {
  const usedIndices = new Set<number>(
    (Object.values(mapping).filter((i) => i !== null) as number[])
  );

  return sheet.rows.map((row) => {
    const get = (field: MappableField): string => {
      const idx = mapping[field];
      return idx !== null ? row[idx] ?? "" : "";
    };

    const eventName = get("eventName");
    const role = get("role");
    const recipientLabel = get("recipientLabel") || "(unlabeled recipient)";

    if (!eventName || !role) {
      return {
        content: {
          recipientLabel,
          eventName,
          role,
          eventType: "Other",
          year: 0,
          claimCode: "",
        },
        skipped: true,
        skipReason: "Missing event name or role",
      };
    }

    const year = parseInt(get("year"), 10) || new Date().getFullYear();
    const endYearRaw = get("endYear");
    const endYear = endYearRaw ? parseInt(endYearRaw, 10) || null : null;
    const claimCode = get("claimCode") || autoClaimCode(eventName, recipientLabel);
    const description = buildDescription(sheet.headers, row, usedIndices, descriptionFormat);

    return {
      content: {
        recipientLabel,
        eventName,
        role,
        eventType: normalizeEventType(get("eventType")),
        year,
        endYear,
        claimCode,
        description: description || undefined,
      },
      skipped: false,
    };
  });
}

/** Build a downloadable CSV so the organizer can distribute claim codes (e.g. via mail merge) after issuing offers. */
export function claimCodesToCsv(offers: BuiltOffer[]): string {
  const header = "recipient,event_name,role,claim_code\n";
  const lines = offers
    .filter((o) => !o.skipped)
    .map((o) => {
      const c = o.content;
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [esc(c.recipientLabel), esc(c.eventName), esc(c.role), esc(c.claimCode)].join(",");
    });
  return header + lines.join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
