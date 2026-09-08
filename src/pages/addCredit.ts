import { nip19 } from "nostr-tools";
import { signCredit, newCreditId, type Visibility } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import type { CreditContent, EventType } from "../lib/schema";
import { state } from "../state";
import { requireIdentity } from "./identityGate";

const EVENT_TYPES: EventType[] = ["Music Festival", "Conference", "Sporting Event", "Corporate Event", "Theater / Live Show", "Other"];

export function renderAddCredit(container: HTMLElement): void {
  if (!requireIdentity(container, () => renderAddCredit(container))) return;

  let selectedVisibility: Visibility = "public";

  container.innerHTML = `
    <h1 class="page-title">Add a credit</h1>
    <p class="page-sub">This gets signed with your key. Public credits show up in the feed and can be peer-confirmed; private ones are encrypted so only you can ever read them.</p>
    <p class="page-sub" style="margin-top:-14px;"><a href="#/credits/import">Or import several at once from your resume →</a></p>
    <div class="card">
      <div class="form-row">
        <label>Event name</label>
        <input type="text" id="cf-eventName" placeholder="e.g. Bonnaroo Music &amp; Arts Festival">
      </div>
      <div class="form-grid-2">
        <div class="form-row">
          <label>Your role</label>
          <input type="text" id="cf-role" placeholder="e.g. Stage Manager">
        </div>
        <div class="form-row">
          <label>Event type</label>
          <select id="cf-type">${EVENT_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-row"><label>Year</label><input type="number" id="cf-year" placeholder="2024"></div>
        <div class="form-row"><label>End year <span class="hint">optional</span></label><input type="number" id="cf-endYear"></div>
      </div>
      <div class="form-row">
        <label>Description <span class="hint">optional</span></label>
        <textarea id="cf-desc" placeholder="What did the job involve?"></textarea>
      </div>
      <div class="form-row">
        <label>Visibility</label>
        <div class="visibility-toggle">
          <div class="visibility-option selected" data-vis="public">
            Public
            <small>Shows in the feed, can be peer-confirmed</small>
          </div>
          <div class="visibility-option" data-vis="private">
            Private
            <small>Encrypted — only you can ever see it, on any device</small>
          </div>
        </div>
      </div>
      <div id="cf-error" class="field-error" style="display:none;"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="cf-save">Sign &amp; publish</button>
      </div>
    </div>
  `;

  container.querySelectorAll<HTMLElement>(".visibility-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      selectedVisibility = opt.dataset.vis as Visibility;
      container.querySelectorAll(".visibility-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });

  document.getElementById("cf-save")!.addEventListener("click", async () => {
    const errEl = document.getElementById("cf-error")!;
    const content: CreditContent = {
      eventName: (document.getElementById("cf-eventName") as HTMLInputElement).value.trim(),
      role: (document.getElementById("cf-role") as HTMLInputElement).value.trim(),
      eventType: (document.getElementById("cf-type") as HTMLSelectElement).value as EventType,
      year: parseInt((document.getElementById("cf-year") as HTMLInputElement).value, 10),
      endYear: (document.getElementById("cf-endYear") as HTMLInputElement).value
        ? parseInt((document.getElementById("cf-endYear") as HTMLInputElement).value, 10)
        : null,
      description: (document.getElementById("cf-desc") as HTMLTextAreaElement).value.trim(),
    };

    if (!content.eventName || !content.role || !content.year) {
      errEl.textContent = "Event name, role, and year are required.";
      errEl.style.display = "block";
      return;
    }

    const event = signCredit(state.me!, newCreditId(), content, selectedVisibility);
    try {
      await publishEvent(event);
      const npub = nip19.npubEncode(state.me!.pubkey);
      location.hash = `#/credits/${npub}`;
    } catch {
      errEl.textContent = "Couldn't reach any relay — please try again.";
      errEl.style.display = "block";
    }
  });
}
