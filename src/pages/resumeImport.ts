import { nip19 } from "nostr-tools";
import {
  extractTextFromFile,
  parseResumeIntoEntries,
  entryToCreditContent,
  type ParsedEntry,
  type Classification,
} from "../lib/resumeParse";
import { signCredit, newCreditId, type Visibility } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import type { EventType } from "../lib/schema";
import { state } from "../state";
import { requireIdentity } from "./identityGate";
import { escapeHtml } from "../util";

const EVENT_TYPES: EventType[] = ["Music Festival", "Conference", "Sporting Event", "Corporate Event", "Theater / Live Show", "Other"];

interface Draft {
  entry: ParsedEntry;
  approved: boolean;
  content: ReturnType<typeof entryToCreditContent>;
}

let allEntries: ParsedEntry[] = [];
let drafts: Map<string, Draft> = new Map();
let visibility: Visibility = "public";

export function renderResumeImportPage(container: HTMLElement): void {
  if (!requireIdentity(container, () => renderResumeImportPage(container))) return;

  allEntries = [];
  drafts = new Map();
  visibility = "public";

  container.innerHTML = `
    <a href="#/credits/add" class="btn btn-outline btn-sm" style="margin-bottom:20px;">‹ Back</a>
    <h1 class="page-title">Import from your resume</h1>
    <p class="page-sub">Upload a resume and we'll pull out likely event-industry credits for you to review. Nothing is published until you approve each one — and anything that isn't clearly event work is filtered out before you even see it as a candidate.</p>

    <div class="warn">This uses simple keyword matching, not AI — it will miss things and occasionally guess wrong. It's a starting point, not an autofill you should trust blindly. Review every field before publishing.</div>

    <div class="card">
      <label>Resume file <span class="hint">.pdf, .docx, or .txt</span></label>
      <input type="file" id="resume-file-input" accept=".pdf,.docx,.txt,.md" style="margin-top:8px;">
      <div id="upload-status" class="muted" style="margin-top:8px;"></div>
    </div>

    <div id="reviewArea"></div>
  `;

  document.getElementById("resume-file-input")!.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const statusEl = document.getElementById("upload-status")!;
    statusEl.textContent = "Reading file…";
    try {
      const text = await extractTextFromFile(file);
      statusEl.textContent = "Scanning for event-industry work…";
      allEntries = parseResumeIntoEntries(text);
      drafts = new Map();

      // Pre-approve confident "event" matches as editable drafts. Ambiguous
      // and non-event entries are NOT added here — they require an explicit
      // yes from the person first (ambiguous) or stay excluded entirely
      // (non-event).
      allEntries
        .filter((entry) => entry.classification === "event")
        .forEach((entry) => {
          drafts.set(entry.id, { entry, approved: true, content: entryToCreditContent(entry) });
        });

      const eventCount = allEntries.filter((e) => e.classification === "event").length;
      const ambiguousCount = allEntries.filter((e) => e.classification === "ambiguous").length;
      const nonEventCount = allEntries.filter((e) => e.classification === "non-event").length;

      statusEl.textContent = `Found ${allEntries.length} entr${allEntries.length === 1 ? "y" : "ies"}: ${eventCount} likely event work, ${ambiguousCount} unclear, ${nonEventCount} excluded as non-event.`;
      renderReview();
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : "Couldn't read that file.";
    }
  });
}

function renderReview(): void {
  const reviewArea = document.getElementById("reviewArea")!;
  const ambiguous = allEntries.filter((e) => e.classification === "ambiguous");
  const nonEvent = allEntries.filter((e) => e.classification === "non-event");

  reviewArea.innerHTML = `
    ${ambiguous.length > 0 ? `
      <div class="card">
        <h3 style="margin-top:0;">Not sure about these ${ambiguous.length}</h3>
        <p class="muted">Doesn't clearly match or clearly not match event-industry work. Nothing here becomes a credit until you say yes.</p>
        <div id="ambiguousList"></div>
      </div>
    ` : ""}

    <div class="card">
      <h3 style="margin-top:0;">Ready to review</h3>
      <div id="draftList"></div>
      ${drafts.size === 0 ? `<p class="muted">Nothing here yet — confirm an entry above, or none were detected.</p>` : ""}
    </div>

    ${nonEvent.length > 0 ? `
      <div class="card">
        <button class="icon-btn" id="toggle-excluded">▸ ${nonEvent.length} entries excluded as non-event work</button>
        <div id="excludedList" style="display:none;margin-top:12px;"></div>
      </div>
    ` : ""}

    ${drafts.size > 0 ? `
      <div class="card">
        <div class="form-row">
          <label>Visibility for everything you publish here</label>
          <div class="visibility-toggle">
            <div class="visibility-option selected" data-vis="public">Public<small>Shows in the feed &amp; can be confirmed</small></div>
            <div class="visibility-option" data-vis="private">Private<small>Encrypted, only you can ever see it</small></div>
          </div>
        </div>
        <div id="publish-error" class="field-error" style="display:none;"></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="publish-btn">Sign &amp; publish ${drafts.size} credit${drafts.size === 1 ? "" : "s"}</button>
        </div>
        <div id="publish-progress"></div>
      </div>
    ` : ""}
  `;

  if (ambiguous.length > 0) renderAmbiguousList(ambiguous);
  renderDraftList();
  if (nonEvent.length > 0) wireExcludedToggle(nonEvent);
  if (drafts.size > 0) wirePublishControls();
}

function renderAmbiguousList(ambiguous: ParsedEntry[]): void {
  const el = document.getElementById("ambiguousList")!;
  el.innerHTML = ambiguous
    .map(
      (entry) => `
    <div class="credit-row" data-entry-id="${entry.id}">
      <div class="credit-desc" style="white-space:pre-line;">${escapeHtml(truncate(entry.rawText, 220))}</div>
      <p style="font-weight:600;margin:10px 0 6px;">Is this event-industry work?</p>
      <div class="form-actions" style="margin-top:0;">
        <button class="btn btn-primary btn-sm confirm-ambiguous" data-id="${entry.id}" data-answer="yes">Yes, it's an event</button>
        <button class="btn btn-outline btn-sm confirm-ambiguous" data-id="${entry.id}" data-answer="no">No, not event work</button>
      </div>
    </div>
  `
    )
    .join("");

  el.querySelectorAll<HTMLButtonElement>(".confirm-ambiguous").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = allEntries.find((e) => e.id === btn.dataset.id)!;
      if (btn.dataset.answer === "yes") {
        drafts.set(entry.id, { entry, approved: true, content: entryToCreditContent(entry) });
      } else {
        // Explicitly marked non-event by the person — reclassify so it moves
        // into the collapsed excluded list instead of asking again.
        entry.classification = "non-event" as Classification;
      }
      renderReview();
    });
  });
}

function renderDraftList(): void {
  const el = document.getElementById("draftList")!;
  const draftArray = [...drafts.values()];

  el.innerHTML = draftArray
    .map(
      (d) => `
    <div class="credit-row" data-draft-id="${d.entry.id}">
      <div class="form-row">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
          <input type="checkbox" class="draft-approve-cb" data-id="${d.entry.id}" ${d.approved ? "checked" : ""}>
          Include this credit
        </label>
      </div>
      <div class="form-row"><label>Event name</label><input type="text" class="draft-field" data-id="${d.entry.id}" data-field="eventName" value="${escapeHtml(d.content.eventName)}"></div>
      <div class="form-grid-2">
        <div class="form-row"><label>Role</label><input type="text" class="draft-field" data-id="${d.entry.id}" data-field="role" value="${escapeHtml(d.content.role)}"></div>
        <div class="form-row"><label>Event type</label>
          <select class="draft-field" data-id="${d.entry.id}" data-field="eventType">
            ${EVENT_TYPES.map((t) => `<option value="${t}" ${d.content.eventType === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Year</label><input type="number" class="draft-field" data-id="${d.entry.id}" data-field="year" value="${d.content.year}"></div>
        <div class="form-row"><label>End year</label><input type="number" class="draft-field" data-id="${d.entry.id}" data-field="endYear" value="${d.content.endYear ?? ""}"></div>
      </div>
      <div class="form-row"><label>Description</label><textarea class="draft-field" data-id="${d.entry.id}" data-field="description">${escapeHtml(d.content.description || "")}</textarea></div>
      <p class="muted">Matched on: ${d.entry.matchedKeywords.map(escapeHtml).join(", ") || "—"}</p>
    </div>
  `
    )
    .join("");

  el.querySelectorAll<HTMLInputElement>(".draft-approve-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const d = drafts.get(cb.dataset.id!);
      if (d) d.approved = cb.checked;
      updatePublishButtonLabel();
    });
  });

  el.querySelectorAll<HTMLElement>(".draft-field").forEach((field) => {
    const handler = () => {
      const d = drafts.get(field.dataset.id!);
      if (!d) return;
      const key = field.dataset.field as keyof Draft["content"];
      const value = (field as HTMLInputElement).value;
      if (key === "year") d.content.year = parseInt(value, 10) || d.content.year;
      else if (key === "endYear") d.content.endYear = value ? parseInt(value, 10) : null;
      else (d.content as any)[key] = value;
    };
    field.addEventListener("input", handler);
    field.addEventListener("change", handler);
  });
}

function updatePublishButtonLabel(): void {
  const approvedCount = [...drafts.values()].filter((d) => d.approved).length;
  const btn = document.getElementById("publish-btn");
  if (btn) btn.textContent = `Sign & publish ${approvedCount} credit${approvedCount === 1 ? "" : "s"}`;
}

function wireExcludedToggle(nonEvent: ParsedEntry[]): void {
  document.getElementById("toggle-excluded")!.addEventListener("click", () => {
    const list = document.getElementById("excludedList")!;
    const isOpen = list.style.display !== "none";
    list.style.display = isOpen ? "none" : "block";
    document.getElementById("toggle-excluded")!.textContent = `${isOpen ? "▸" : "▾"} ${nonEvent.length} entries excluded as non-event work`;
    if (!isOpen) {
      list.innerHTML = nonEvent
        .map((entry) => `<div class="credit-row"><div class="credit-desc" style="white-space:pre-line;">${escapeHtml(truncate(entry.rawText, 160))}</div></div>`)
        .join("");
    }
  });
}

function wirePublishControls(): void {
  document.querySelectorAll<HTMLElement>(".visibility-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      visibility = opt.dataset.vis as Visibility;
      document.querySelectorAll(".visibility-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });

  document.getElementById("publish-btn")!.addEventListener("click", publishApproved);
}

async function publishApproved(): Promise<void> {
  const errEl = document.getElementById("publish-error")!;
  const progressEl = document.getElementById("publish-progress")!;
  const toPublish = [...drafts.values()].filter((d) => d.approved);

  if (toPublish.length === 0) {
    errEl.textContent = "Nothing is checked to include.";
    errEl.style.display = "block";
    return;
  }
  errEl.style.display = "none";

  let done = 0;
  progressEl.innerHTML = `<p class="muted">Publishing ${done} / ${toPublish.length}…</p>`;

  for (const d of toPublish) {
    const event = signCredit(state.me!, newCreditId(), d.content, visibility);
    try {
      await publishEvent(event);
    } catch {
      // continue with the rest of the batch even if one relay call fails
    }
    done++;
    progressEl.innerHTML = `<p class="muted">Publishing ${done} / ${toPublish.length}…</p>`;
  }

  const npub = nip19.npubEncode(state.me!.pubkey);
  progressEl.innerHTML = `<p>Done. <a href="#/credits/${npub}">View your credits</a></p>`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
