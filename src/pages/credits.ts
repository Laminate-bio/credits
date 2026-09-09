import { nip19, type Event } from "nostr-tools";
import { fetchResumeFor, fetchDisplayName, VERIFICATION_THRESHOLD, type ResolvedCredit } from "../lib/directory";
import { signConfirmation, retractConfirmation, signCredit, type Visibility } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import type { CreditContent, EventType } from "../lib/schema";
import { state } from "../state";
import { escapeHtml } from "../util";

const EVENT_TYPES: EventType[] = ["Music Festival", "Conference", "Sporting Event", "Corporate Event", "Theater / Live Show", "Other"];

export async function renderCreditsPage(container: HTMLElement, npub: string): Promise<void> {
  let pubkey: string;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== "npub") throw new Error();
    pubkey = decoded.data as string;
  } catch {
    container.innerHTML = `<div class="error-box">That doesn't look like a valid profile link.</div>`;
    return;
  }

  const isOwner = !!state.me && state.me.pubkey === pubkey;

  container.innerHTML = `
    <a href="#/profile/${npub}" class="btn btn-outline btn-sm" style="margin-bottom:20px;">‹ Back to profile</a>
    <div class="loading">Loading…</div>
  `;

  const displayName = await fetchDisplayName(pubkey);

  container.innerHTML = `
    <a href="#/profile/${npub}" class="btn btn-outline btn-sm" style="margin-bottom:20px;">‹ Back to profile</a>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <h1 class="page-title" style="margin-bottom:0;">${escapeHtml(displayName)}</h1>
        <p class="page-sub" style="margin-top:2px;">Credits</p>
      </div>
      <a href="#/reel/${npub}" class="btn btn-outline btn-sm">Generate a video</a>
    </div>
    <div id="creditsBody" class="loading">Loading from relays…</div>
  `;

  const body = document.getElementById("creditsBody")!;
  let resume: ResolvedCredit[] = [];
  try {
    resume = await fetchResumeFor(pubkey, state.me);
  } catch {
    body.innerHTML = `<div class="error-box">Couldn't reach any relay. Check your connection and refresh.</div>`;
    return;
  }

  if (resume.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <h3>No credits ${isOwner ? "logged" : "found"} yet.</h3>
        ${isOwner ? `<p>Log the first one.</p><a href="#/credits/add" class="btn btn-primary">Add a credit</a>` : `<p>Nothing public here yet.</p>`}
      </div>`;
    return;
  }

  const groups = new Map<string, ResolvedCredit[]>();
  resume.forEach((c) => {
    const key = c.content.endYear ? `${c.content.year}–${c.content.endYear}` : `${c.content.year}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  });

  body.innerHTML = [...groups.entries()]
    .map(
      ([yearLabel, items]) => `
      <div class="year-group">
        <div class="page-sub" style="font-family:var(--font-display);font-size:17px;font-weight:600;color:var(--teal-dark);margin:18px 0 6px;">${yearLabel}</div>
        ${items.map((c) => creditRowHtml(c, isOwner)).join("")}
      </div>
    `
    )
    .join("");

  const explainer = document.createElement("div");
  explainer.className = "warn";
  explainer.style.marginTop = "0";
  explainer.innerHTML = isOwner
    ? `Credits get a <strong>Verified</strong> badge once 2 people who were actually there confirm it. You can't verify your own — share your profile link (from the profile page) with people you worked alongside so they can.`
    : `A credit gets a <strong>Verified</strong> badge once 2 people confirm they were there too. If you worked alongside ${escapeHtml(displayName)} on something below, use the verify button on that credit.`;
  body.prepend(explainer);

  attachHandlers(resume, isOwner, pubkey);
}

function creditRowHtml(c: ResolvedCredit, isOwner: boolean): string {
  const confirmations = c.confirmedBy.length;
  const isVerified = confirmations >= VERIFICATION_THRESHOLD;
  const viewerConfirmed = !!state.me && c.confirmedBy.includes(state.me.pubkey);

  return `
    <div class="credit-row" data-event-id="${c.event.id}">
      <div class="credit-event">
        ${escapeHtml(c.content.eventName)}
        ${isVerified ? `<span class="verified-badge">Verified</span>` : ""}
        ${c.isPrivate ? `<span class="credit-private-tag">Private</span>` : ""}
      </div>
      <div class="credit-role">${escapeHtml(c.content.role)}</div>
      <div class="credit-type-tag">${escapeHtml(c.content.eventType)}</div>
      ${c.content.description ? `<div class="credit-desc">${escapeHtml(c.content.description)}</div>` : ""}

      ${!c.isPrivate && confirmations > 0 ? `<div class="confirmed-by">${confirmations} verification${confirmations === 1 ? "" : "s"}${isVerified ? "" : ` (needs ${VERIFICATION_THRESHOLD - confirmations} more)`}</div>` : ""}

      ${isOwner
        ? `<div class="credit-actions"><button class="icon-btn edit-credit-btn" data-id="${c.event.id}">Edit</button></div>`
        : !c.isPrivate
        ? state.me
          ? `<button class="confirm-toggle-btn ${viewerConfirmed ? "confirmed" : ""}" data-id="${c.event.id}" data-action="${viewerConfirmed ? "unconfirm" : "confirm"}">${viewerConfirmed ? "You verified this — undo" : "Verify — I was there too"}</button>`
          : `<div class="muted"><a href="#/profile">Set up your profile</a> to verify this credit.</div>`
        : ""}
    </div>
  `;
}

function attachHandlers(resume: ResolvedCredit[], isOwner: boolean, ownerPubkey: string): void {
  document.querySelectorAll<HTMLButtonElement>(".confirm-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.me) return;
      const creditEvent = resume.find((c) => c.event.id === btn.dataset.id)?.event;
      if (!creditEvent) return;
      btn.disabled = true;
      btn.textContent = "Saving…";
      const event = btn.dataset.action === "confirm"
        ? signConfirmation(state.me, creditEvent)
        : retractConfirmation(state.me, creditEvent);
      await publishEvent(event);
      const npub = nip19.npubEncode(ownerPubkey);
      const container = document.getElementById("app")!;
      renderCreditsPage(container, npub);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".edit-credit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const resolved = resume.find((c) => c.event.id === btn.dataset.id);
      if (resolved) showInlineEditForm(resolved);
    });
  });
}

function showInlineEditForm(resolved: ResolvedCredit): void {
  const row = document.querySelector(`[data-event-id="${resolved.event.id}"]`) as HTMLElement;
  if (!row) return;
  const c = resolved.content;

  row.innerHTML = `
    <div class="form-row">
      <label>Event name</label>
      <input type="text" id="ef-eventName" value="${escapeHtml(c.eventName)}">
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Role</label><input type="text" id="ef-role" value="${escapeHtml(c.role)}"></div>
      <div class="form-row">
        <label>Event type</label>
        <select id="ef-type">${EVENT_TYPES.map((t) => `<option value="${t}" ${c.eventType === t ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
    </div>
    <div class="form-grid-2">
      <div class="form-row"><label>Year</label><input type="number" id="ef-year" value="${c.year}"></div>
      <div class="form-row"><label>End year</label><input type="number" id="ef-endYear" value="${c.endYear ?? ""}"></div>
    </div>
    <div class="form-row"><label>Description</label><textarea id="ef-desc">${escapeHtml(c.description || "")}</textarea></div>
    <div class="form-row">
      <label>Visibility</label>
      <div class="visibility-toggle">
        <div class="visibility-option ${!resolved.isPrivate ? "selected" : ""}" data-vis="public">Public<small>Shows in the feed &amp; can be confirmed</small></div>
        <div class="visibility-option ${resolved.isPrivate ? "selected" : ""}" data-vis="private">Private<small>Encrypted, only you can ever see it</small></div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="ef-save">Save</button>
      <button class="btn btn-outline" id="ef-cancel">Cancel</button>
    </div>
  `;

  let selectedVisibility: Visibility = resolved.isPrivate ? "private" : "public";
  row.querySelectorAll<HTMLElement>(".visibility-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      selectedVisibility = opt.dataset.vis as Visibility;
      row.querySelectorAll(".visibility-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });

  document.getElementById("ef-cancel")!.addEventListener("click", () => {
    const npub = nip19.npubEncode(resolved.event.pubkey);
    renderCreditsPage(document.getElementById("app")!, npub);
  });

  document.getElementById("ef-save")!.addEventListener("click", async () => {
    if (!state.me) return;
    const content: CreditContent = {
      eventName: (document.getElementById("ef-eventName") as HTMLInputElement).value.trim(),
      role: (document.getElementById("ef-role") as HTMLInputElement).value.trim(),
      eventType: (document.getElementById("ef-type") as HTMLSelectElement).value as EventType,
      year: parseInt((document.getElementById("ef-year") as HTMLInputElement).value, 10),
      endYear: (document.getElementById("ef-endYear") as HTMLInputElement).value
        ? parseInt((document.getElementById("ef-endYear") as HTMLInputElement).value, 10)
        : null,
      description: (document.getElementById("ef-desc") as HTMLTextAreaElement).value.trim(),
    };
    const creditId = resolved.event.tags.find((t) => t[0] === "d")?.[1]!;
    const event = signCredit(state.me, creditId, content, selectedVisibility);
    await publishEvent(event);
    const npub = nip19.npubEncode(state.me.pubkey);
    renderCreditsPage(document.getElementById("app")!, npub);
  });
}
