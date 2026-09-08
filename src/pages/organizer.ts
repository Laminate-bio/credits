import { createIdentity, type Identity } from "../lib/identity";
import { signOrgProfile, signCredentialOffer, claimOffer } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import { fetchOfferByClaimCode } from "../lib/directory";
import type { CredentialOfferContent } from "../lib/schema";
import { state, saveOrgIdentity } from "../state";
import { escapeHtml } from "../util";
import {
  parseSpreadsheet,
  guessColumnMapping,
  buildOffers,
  claimCodesToCsv,
  downloadCsv,
  FIELD_LABELS,
  type ParsedSheet,
  type ColumnMapping,
  type MappableField,
  type DescriptionFormat,
  type BuiltOffer,
} from "../lib/xlsxImport";

// Module-level state for the current upload — reset each time the page loads.
let sheet: ParsedSheet | null = null;
let mapping: ColumnMapping | null = null;
let descriptionFormat: DescriptionFormat = "lines";

export function renderOrganizerPage(container: HTMLElement): void {
  sheet = null;
  mapping = null;
  descriptionFormat = "lines";

  container.innerHTML = `
    <h1 class="page-title">For event organizers</h1>
    <p class="page-sub">Bulk-issue credits to your staff from a spreadsheet. This never writes directly to anyone's profile — each worker has to claim their offer with their own signature before it appears anywhere.</p>
    <div class="warn">This is a demo flow using a throwaway "organization" identity stored only in this browser. A real deployment would give organizations a proper verification path (domain proof, community approval) before they can issue offers.</div>

    <div class="card">
      <h3 style="margin-top:0;">1. Your organization identity</h3>
      <div id="orgIdentityDisplay"></div>
    </div>

    <div class="card" id="uploadCard" style="display:none;">
      <h3 style="margin-top:0;">2. Upload your staff list</h3>
      <p class="muted">An .xlsx file with a header row. We'll try to match your column names automatically — recognized headers include things like "Name", "Event", "Role", "Type", "Year", but you can remap anything below. Any extra columns you don't map get folded into each offer's description.</p>
      <input type="file" id="staff-file-input" accept=".xlsx,.xls">
      <div id="uploadStatus" class="muted" style="margin-top:8px;"></div>
    </div>

    <div id="mappingCard"></div>
    <div id="previewCard"></div>
    <div id="publishCard"></div>

    <div class="card">
      <h3 style="margin-top:0;">3. Claim an offer</h3>
      <p class="muted">If you're a worker who received a claim code, enter it here — you'll need your own Laminate identity first.</p>
      <div class="form-row"><label>Claim code</label><input type="text" id="claim-code-input" placeholder="BONNAROO24-DANA"></div>
      <div class="form-actions"><button class="btn btn-outline" id="claim-btn">Find &amp; claim this credit</button></div>
      <p class="muted" id="claim-status"></p>
    </div>
  `;

  renderOrgIdentity();
  wireFileInput();
  wireClaimForm();
}

function renderOrgIdentity(): void {
  const el = document.getElementById("orgIdentityDisplay")!;
  const uploadCard = document.getElementById("uploadCard")!;

  if (!state.org) {
    el.innerHTML = `<button class="btn btn-outline" id="create-org">Create a demo org identity</button>`;
    uploadCard.style.display = "none";
    document.getElementById("create-org")!.addEventListener("click", () => {
      const identity: Identity = createIdentity();
      saveOrgIdentity(identity);
      publishEvent(signOrgProfile(identity, { name: "Demo Organization" })).catch(() => {});
      renderOrgIdentity();
    });
  } else {
    el.innerHTML = `<div class="muted" style="font-family:monospace;">Org pubkey: ${state.org.npub}</div>`;
    uploadCard.style.display = "block";
  }
}

function wireFileInput(): void {
  document.getElementById("staff-file-input")!.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const statusEl = document.getElementById("uploadStatus")!;
    statusEl.textContent = "Reading spreadsheet…";
    try {
      sheet = await parseSpreadsheet(file);
      if (sheet.headers.length === 0 || sheet.rows.length === 0) {
        statusEl.textContent = "That file looks empty — make sure it has a header row and at least one data row.";
        sheet = null;
        return;
      }
      mapping = guessColumnMapping(sheet.headers);
      statusEl.textContent = `Loaded ${sheet.rows.length} row${sheet.rows.length === 1 ? "" : "s"}. Check the column mapping below.`;
      renderMappingCard();
    } catch {
      statusEl.textContent = "Couldn't read that file — make sure it's a valid .xlsx.";
      sheet = null;
    }
  });
}

const REQUIRED_FIELDS: MappableField[] = ["recipientLabel", "eventName", "role"];
const ALL_FIELDS: MappableField[] = ["recipientLabel", "eventName", "role", "eventType", "year", "endYear", "claimCode"];

function renderMappingCard(): void {
  if (!sheet || !mapping) return;
  const card = document.getElementById("mappingCard")!;

  card.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">3. Check the column mapping</h3>
      ${ALL_FIELDS.map((field) => `
        <div class="form-row">
          <label>${FIELD_LABELS[field]}${REQUIRED_FIELDS.includes(field) ? "" : " <span class=\"hint\">optional</span>"}</label>
          <select data-field="${field}" class="mapping-select">
            <option value="">— Don't map —</option>
            ${sheet!.headers.map((h, i) => `<option value="${i}" ${mapping![field] === i ? "selected" : ""}>${escapeHtml(h)}</option>`).join("")}
          </select>
        </div>
      `).join("")}

      <div class="form-row">
        <label>Unmapped columns → description</label>
        <select id="desc-format-select">
          <option value="lines" ${descriptionFormat === "lines" ? "selected" : ""}>One per line — "Header: value"</option>
          <option value="comma" ${descriptionFormat === "comma" ? "selected" : ""}>Comma-separated on one line</option>
          <option value="none" ${descriptionFormat === "none" ? "selected" : ""}>Don't include extra columns</option>
        </select>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" id="preview-btn">Preview offers</button>
      </div>
    </div>
  `;

  card.querySelectorAll<HTMLSelectElement>(".mapping-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      const field = sel.dataset.field as MappableField;
      mapping![field] = sel.value === "" ? null : parseInt(sel.value, 10);
    });
  });
  document.getElementById("desc-format-select")!.addEventListener("change", (e) => {
    descriptionFormat = (e.target as HTMLSelectElement).value as DescriptionFormat;
  });
  document.getElementById("preview-btn")!.addEventListener("click", renderPreviewCard);
}

let lastBuiltOffers: BuiltOffer[] = [];

function renderPreviewCard(): void {
  if (!sheet || !mapping) return;
  const missingRequired = REQUIRED_FIELDS.filter((f) => mapping![f] === null);
  const previewCard = document.getElementById("previewCard")!;

  if (missingRequired.length > 0) {
    previewCard.innerHTML = `<div class="error-box">Map at least: ${missingRequired.map((f) => FIELD_LABELS[f]).join(", ")} before previewing.</div>`;
    return;
  }

  lastBuiltOffers = buildOffers(sheet, mapping, descriptionFormat);
  const skippedCount = lastBuiltOffers.filter((o) => o.skipped).length;
  const validCount = lastBuiltOffers.length - skippedCount;

  previewCard.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">4. Preview</h3>
      <p class="muted">${validCount} offer${validCount === 1 ? "" : "s"} ready to publish${skippedCount ? `, ${skippedCount} skipped (missing event name or role)` : ""}.</p>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;">
        ${lastBuiltOffers.slice(0, 25).map((o) => `
          <div class="credit-row" style="${o.skipped ? "opacity:0.5;" : ""}">
            <div class="credit-event">${escapeHtml(o.content.recipientLabel)}${o.skipped ? ` <span class="credit-private-tag">Skipped</span>` : ""}</div>
            <div class="credit-role">${escapeHtml(o.content.eventName)} · ${escapeHtml(o.content.role)} · ${escapeHtml(o.content.eventType)} · ${o.content.year}</div>
            ${o.content.description ? `<div class="credit-desc" style="white-space:pre-line;">${escapeHtml(o.content.description)}</div>` : ""}
            ${!o.skipped ? `<div class="muted" style="margin-top:4px;">Claim code: ${escapeHtml(o.content.claimCode)}</div>` : ""}
          </div>
        `).join("")}
        ${lastBuiltOffers.length > 25 ? `<div class="muted" style="padding:10px;">…and ${lastBuiltOffers.length - 25} more</div>` : ""}
      </div>
      <div id="publish-error" class="field-error" style="display:none;"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="publish-btn">Sign &amp; publish ${validCount} offer${validCount === 1 ? "" : "s"}</button>
      </div>
    </div>
  `;

  document.getElementById("publish-btn")!.addEventListener("click", publishAllOffers);
}

async function publishAllOffers(): Promise<void> {
  if (!state.org) return;
  const publishCard = document.getElementById("publishCard")!;
  const toPublish = lastBuiltOffers.filter((o) => !o.skipped);
  let done = 0;

  publishCard.innerHTML = `<div class="card"><p class="muted" id="publish-progress">Publishing 0 / ${toPublish.length}…</p></div>`;
  const progressEl = document.getElementById("publish-progress")!;

  for (const offer of toPublish) {
    const event = signCredentialOffer(state.org, crypto.randomUUID(), offer.content);
    try {
      await publishEvent(event);
    } catch {
      // Keep going — a relay hiccup on one row shouldn't abandon the whole batch.
    }
    done++;
    progressEl.textContent = `Publishing ${done} / ${toPublish.length}…`;
  }

  const csv = claimCodesToCsv(toPublish);
  publishCard.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Done</h3>
      <p>${toPublish.length} offer${toPublish.length === 1 ? "" : "s"} published. Distribute each claim code to the matching worker (email, text, printed badge) — nothing appears on their profile until they claim it themselves.</p>
      <button class="btn btn-outline" id="download-csv-btn">Download claim codes (.csv)</button>
    </div>
  `;
  document.getElementById("download-csv-btn")!.addEventListener("click", () => {
    downloadCsv("laminate-claim-codes.csv", csv);
  });
}

function wireClaimForm(): void {
  document.getElementById("claim-btn")!.addEventListener("click", async () => {
    const statusEl = document.getElementById("claim-status")!;
    if (!state.me) {
      if (!confirm("You need your own Laminate identity before claiming a credit. Go set one up now?")) return;
      location.hash = "#/profile";
      return;
    }
    const code = (document.getElementById("claim-code-input") as HTMLInputElement).value.trim();
    if (!code) return;
    statusEl.textContent = "Searching relays for this claim code…";
    const offerEvent = await fetchOfferByClaimCode(code);
    if (!offerEvent) {
      statusEl.textContent = "No offer found with that claim code.";
      return;
    }
    const offerContent = JSON.parse(offerEvent.content) as CredentialOfferContent;
    const creditEvent = claimOffer(state.me, offerEvent, offerContent);
    await publishEvent(creditEvent);
    statusEl.textContent = "Claimed! It's now a credit signed by you.";
  });
}
