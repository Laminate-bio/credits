import { nip19 } from "nostr-tools";
import { fetchProfile } from "../lib/directory";
import { signProfile } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import type { ProfileContent } from "../lib/schema";
import { state } from "../state";
import { requireIdentity } from "./identityGate";
import { renderNav } from "./nav";
import { escapeHtml } from "../util";

/** `npub` is undefined when viewing your own profile via "#/profile". */
export async function renderProfileView(container: HTMLElement, npub?: string): Promise<void> {
  let pubkey: string;
  let isOwner: boolean;

  if (npub) {
    try {
      const decoded = nip19.decode(npub);
      if (decoded.type !== "npub") throw new Error();
      pubkey = decoded.data as string;
    } catch {
      container.innerHTML = `<div class="error-box">That doesn't look like a valid profile link.</div>`;
      return;
    }
    isOwner = !!state.me && state.me.pubkey === pubkey;
  } else {
    if (!requireIdentity(container, () => renderProfileView(container))) return;
    pubkey = state.me!.pubkey;
    isOwner = true;
  }

  container.innerHTML = `<div class="loading">Loading profile…</div>`;
  const profile = await fetchProfile(pubkey);
  const npubDisplay = nip19.npubEncode(pubkey);

  if (isOwner && profile?.name && profile.name !== state.myDisplayName) {
    state.myDisplayName = profile.name;
    renderNav();
  }

  if (!profile) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>${isOwner ? "You haven't set up a profile yet." : "No profile found."}</h3>
        <p>${isOwner ? "Add your name, role, and bio so people can find you." : "This identity exists but hasn't published a profile."}</p>
        ${isOwner ? `<a href="#/profile/edit" class="btn btn-primary">Set up your profile</a>` : ""}
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="pass">
      <div class="pass-hole"></div>
      <h1 class="pass-name">${escapeHtml(profile.name)}</h1>
      ${profile.title ? `<div class="pass-title">${escapeHtml(profile.title)}</div>` : ""}
      <div class="pass-meta">
        ${profile.location ? `<span>${escapeHtml(profile.location)}</span>` : ""}
      </div>
      ${profile.about ? `<div class="pass-bio">${escapeHtml(profile.about)}</div>` : ""}
      ${profile.skills?.length ? `<div class="pass-skills">${profile.skills.map((s) => `<span class="skill-tag">${escapeHtml(s)}</span>`).join("")}</div>` : ""}
      <div class="pass-actions">
        <a href="#/credits/${npubDisplay}" class="btn btn-outline btn-sm">View credits</a>
        <button class="btn btn-outline btn-sm" id="copy-profile-link">Copy profile link</button>
        ${isOwner ? `<a href="#/profile/edit" class="btn btn-outline btn-sm">Edit profile</a>` : ""}
      </div>
    </div>
  `;

  document.getElementById("copy-profile-link")!.addEventListener("click", async (e) => {
    const url = `${location.origin}${location.pathname}#/profile/${npubDisplay}`;
    await navigator.clipboard.writeText(url);
    const btn = e.currentTarget as HTMLButtonElement;
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1500);
  });
}

export function renderProfileEdit(container: HTMLElement): void {
  if (!requireIdentity(container, () => renderProfileEdit(container))) return;

  container.innerHTML = `<div class="loading">Loading…</div>`;

  fetchProfile(state.me!.pubkey).then((existing) => {
    const profile: ProfileContent = existing ?? { name: "", about: "", title: "", location: "", skills: [] };

    container.innerHTML = `
      <a href="#/profile" class="btn btn-outline btn-sm" style="margin-bottom:20px;">‹ Back to your profile</a>
      <h1 class="page-title">${existing ? "Edit your profile" : "Set up your profile"}</h1>
      <div class="card">
        <div class="form-row">
          <label>Full name</label>
          <input type="text" id="pf-name" value="${escapeHtml(profile.name)}" placeholder="e.g. Dana Reyes">
        </div>
        <div class="form-row">
          <label>Title / what you do <span class="hint">e.g. "FOH Audio Engineer"</span></label>
          <input type="text" id="pf-title" value="${escapeHtml(profile.title || "")}" placeholder="e.g. FOH Audio Engineer">
        </div>
        <div class="form-row">
          <label>Location <span class="hint">optional</span></label>
          <input type="text" id="pf-location" value="${escapeHtml(profile.location || "")}" placeholder="e.g. Austin, TX">
        </div>
        <div class="form-row">
          <label>About <span class="hint">optional</span></label>
          <textarea id="pf-bio" placeholder="A couple sentences on your background.">${escapeHtml(profile.about || "")}</textarea>
        </div>
        <div class="form-row">
          <label>Skills <span class="hint">comma-separated</span></label>
          <input type="text" id="pf-skills" value="${escapeHtml((profile.skills || []).join(", "))}" placeholder="e.g. RF coordination, ETC consoles">
        </div>
        <div id="pf-error" class="field-error" style="display:none;"></div>
        <div class="form-actions">
          <button class="btn btn-primary" id="pf-save">Save profile</button>
        </div>
      </div>
    `;

    document.getElementById("pf-save")!.addEventListener("click", async () => {
      const name = (document.getElementById("pf-name") as HTMLInputElement).value.trim();
      const title = (document.getElementById("pf-title") as HTMLInputElement).value.trim();
      const location_ = (document.getElementById("pf-location") as HTMLInputElement).value.trim();
      const about = (document.getElementById("pf-bio") as HTMLTextAreaElement).value.trim();
      const skillsRaw = (document.getElementById("pf-skills") as HTMLInputElement).value.trim();
      const errEl = document.getElementById("pf-error")!;

      if (!name) {
        errEl.textContent = "Name is required.";
        errEl.style.display = "block";
        return;
      }

      const content: ProfileContent = {
        name,
        title,
        location: location_,
        about,
        skills: skillsRaw ? skillsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
      };

      const event = signProfile(state.me!, content);
      try {
        await publishEvent(event);
        state.myDisplayName = name;
        renderNav();
        location.hash = "#/profile";
      } catch {
        errEl.textContent = "Couldn't reach any relay — please try again.";
        errEl.style.display = "block";
      }
    });

    renderAdvancedSection(container);
  });
}

function renderAdvancedSection(container: HTMLElement): void {
  const me = state.me!;
  const advancedHtml = `
    <div class="card" style="margin-top:20px;">
      <button class="icon-btn" id="toggle-advanced" style="font-weight:600;">▸ Advanced: your keys</button>
      <div id="advanced-body" style="display:none;margin-top:14px;">
        <p class="muted">Your public ID — safe to share, this is how others find your profile.</p>
        <div style="font-family:monospace;font-size:13px;background:var(--paper-dim);padding:8px 10px;border-radius:4px;word-break:break-all;">${me.npub}</div>

        ${me.mnemonic ? `
          <p class="muted" style="margin-top:16px;">Your recovery phrase — never share this. Anyone with it can act as you.</p>
          <button class="btn btn-outline btn-sm" id="reveal-phrase">Show recovery phrase</button>
          <div id="phrase-display" style="display:none;font-family:monospace;font-size:13px;background:var(--paper-dim);padding:10px;border-radius:4px;margin-top:8px;word-break:break-word;">${escapeHtml(me.mnemonic)}</div>
        ` : `<p class="muted" style="margin-top:16px;">This identity was restored from a raw key, so there's no recovery phrase on file for it.</p>`}
      </div>
    </div>
  `;
  container.insertAdjacentHTML("beforeend", advancedHtml);

  document.getElementById("toggle-advanced")!.addEventListener("click", () => {
    const body = document.getElementById("advanced-body")!;
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "block";
    document.getElementById("toggle-advanced")!.textContent = isOpen ? "▸ Advanced: your keys" : "▾ Advanced: your keys";
  });

  document.getElementById("reveal-phrase")?.addEventListener("click", () => {
    document.getElementById("phrase-display")!.style.display = "block";
  });
}
