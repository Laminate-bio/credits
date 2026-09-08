import { createIdentity, identityFromMnemonic, identityFromNsec, saveIdentityLocally } from "../lib/identity";
import { signProfile } from "../lib/credentials";
import { publishEvent } from "../lib/relay";
import { fetchProfile } from "../lib/directory";
import { state } from "../state";
import { renderNav } from "./nav";
import { escapeHtml } from "../util";

/**
 * Renders a create/restore-identity prompt into `container` if nobody's
 * signed in yet, and returns false. If someone's already signed in,
 * renders nothing and returns true — callers should proceed with their
 * normal page content in that case.
 *
 * `onReady` fires once an identity exists and any backup step is done,
 * so callers can move on to their normal page (e.g. profile setup)
 * instead of just reloading.
 */
export function requireIdentity(container: HTMLElement, onReady?: () => void): boolean {
  if (state.me) return true;

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Set up your identity</h3>
      <p class="muted">No usernames or passwords here — your identity is a key pair only you hold. Setup takes one click.</p>
      <button class="btn btn-primary" id="create-identity">Create my identity</button>

      <p class="muted" style="margin-top:20px;">Already have one, from another device?</p>
      <button class="btn btn-outline btn-sm" id="show-restore">Restore with my recovery phrase</button>
      <div id="restore-area"></div>
    </div>
  `;

  document.getElementById("create-identity")!.addEventListener("click", () => {
    const identity = createIdentity();
    showBackupScreen(container, identity, onReady);
  });

  document.getElementById("show-restore")!.addEventListener("click", () => {
    renderRestoreForm(container, document.getElementById("restore-area")!, onReady);
  });

  return false;
}

function showBackupScreen(container: HTMLElement, identity: ReturnType<typeof createIdentity>, onReady?: () => void): void {
  const words = identity.mnemonic.split(" ");

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Save your recovery phrase</h3>
      <p>These 12 words are the only way to get back to this identity on a new device, or if you clear your browser. Write them down or save them in a password manager — anyone with these words can act as you.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0;font-family:monospace;">
        ${words.map((w, i) => `<div style="background:var(--paper-dim);border-radius:4px;padding:8px 10px;"><span class="muted">${i + 1}.</span> ${escapeHtml(w)}</div>`).join("")}
      </div>
      <button class="btn btn-outline btn-sm" id="copy-phrase">Copy phrase</button>
      <div style="margin-top:18px;">
        <label style="display:flex;align-items:flex-start;gap:8px;font-weight:400;font-size:14px;cursor:pointer;">
          <input type="checkbox" id="confirm-saved" style="margin-top:3px;">
          I've saved these words somewhere safe
        </label>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="continue-btn" disabled>Continue</button>
      </div>
    </div>
  `;

  document.getElementById("copy-phrase")!.addEventListener("click", async () => {
    await navigator.clipboard.writeText(identity.mnemonic);
    const btn = document.getElementById("copy-phrase")!;
    btn.textContent = "Copied";
    setTimeout(() => (btn.textContent = "Copy phrase"), 1500);
  });

  const checkbox = document.getElementById("confirm-saved") as HTMLInputElement;
  const continueBtn = document.getElementById("continue-btn") as HTMLButtonElement;
  checkbox.addEventListener("change", () => {
    continueBtn.disabled = !checkbox.checked;
  });

  continueBtn.addEventListener("click", () => {
    saveIdentityLocally(identity);
    state.me = identity;
    renderNav();
    showNameStep(container, onReady);
  });
}

/**
 * Everyone lands here right after creating (or restoring) an identity,
 * before doing anything else. Without this step it's genuinely possible
 * to post credits and confirmations under a nameless identity — the
 * feed and credit pages have nothing to show but a cryptic npub for
 * that person, which defeats the "show off your credits" point of the
 * whole app. Skippable (people can always set it later from Profile →
 * Edit), but this is the default path, not an easy-to-miss extra step.
 */
function showNameStep(container: HTMLElement, onReady?: () => void): void {
  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">What should people call you?</h3>
      <p class="muted">This is what shows up on your credits, in the feed, and on any video you generate — without it you'll just look like an anonymous string of letters to everyone else.</p>
      <div class="form-row">
        <label>Full name</label>
        <input type="text" id="ns-name" placeholder="e.g. Dana Reyes">
      </div>
      <div class="form-row">
        <label>Title / what you do <span class="hint">optional</span></label>
        <input type="text" id="ns-title" placeholder="e.g. FOH Audio Engineer">
      </div>
      <div id="ns-error" class="field-error" style="display:none;"></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="ns-save">Save &amp; continue</button>
        <button class="icon-btn" id="ns-skip">Skip for now</button>
      </div>
    </div>
  `;

  document.getElementById("ns-save")!.addEventListener("click", async () => {
    const name = (document.getElementById("ns-name") as HTMLInputElement).value.trim();
    const title = (document.getElementById("ns-title") as HTMLInputElement).value.trim();
    const errEl = document.getElementById("ns-error")!;
    if (!name) {
      errEl.textContent = "Enter a name — it's how everyone else will recognize you.";
      errEl.style.display = "block";
      return;
    }
    const event = signProfile(state.me!, { name, title });
    try {
      await publishEvent(event);
      state.myDisplayName = name;
      renderNav();
      onReady ? onReady() : location.reload();
    } catch {
      errEl.textContent = "Couldn't reach any relay — please try again.";
      errEl.style.display = "block";
    }
  });

  document.getElementById("ns-skip")!.addEventListener("click", () => {
    onReady ? onReady() : location.reload();
  });
}

async function proceedAfterRestore(container: HTMLElement, identity: ReturnType<typeof createIdentity>, onReady?: () => void): Promise<void> {
  saveIdentityLocally(identity);
  state.me = identity;
  renderNav();

  const existing = await fetchProfile(identity.pubkey);
  if (existing?.name) {
    state.myDisplayName = existing.name;
    renderNav();
    onReady ? onReady() : location.reload();
  } else {
    showNameStep(container, onReady);
  }
}

function renderRestoreForm(fullContainer: HTMLElement, restoreArea: HTMLElement, onReady?: () => void): void {
  restoreArea.innerHTML = `
    <div style="margin-top:14px;">
      <label style="font-size:13px;font-weight:600;">Recovery phrase <span class="muted" style="font-weight:400;">12 words, separated by spaces</span></label>
      <textarea id="restore-phrase" placeholder="word1 word2 word3 ..." style="width:100%;min-height:60px;padding:8px;border:1px solid var(--line);border-radius:4px;margin-top:6px;"></textarea>
      <button class="btn btn-outline btn-sm" id="restore-submit" style="margin-top:8px;">Restore</button>
      <div id="restore-error" class="field-error" style="display:none;"></div>
      <p class="muted" style="margin-top:14px;">
        <a href="#" id="show-advanced">Advanced: restore from a raw key instead</a>
      </p>
      <div id="advanced-area"></div>
    </div>
  `;

  document.getElementById("restore-submit")!.addEventListener("click", async () => {
    const phrase = (document.getElementById("restore-phrase") as HTMLTextAreaElement).value;
    const errEl = document.getElementById("restore-error")!;
    try {
      const identity = identityFromMnemonic(phrase);
      await proceedAfterRestore(fullContainer, identity, onReady);
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : "Couldn't restore from that phrase.";
      errEl.style.display = "block";
    }
  });

  document.getElementById("show-advanced")!.addEventListener("click", (e) => {
    e.preventDefault();
    const advanced = document.getElementById("advanced-area")!;
    advanced.innerHTML = `
      <label style="font-size:13px;font-weight:600;">Raw private key <span class="muted" style="font-weight:400;">starts with nsec1...</span></label>
      <input type="text" id="restore-nsec" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;margin-top:6px;">
      <button class="btn btn-outline btn-sm" id="restore-nsec-submit" style="margin-top:8px;">Restore from key</button>
      <div id="restore-nsec-error" class="field-error" style="display:none;"></div>
    `;
    document.getElementById("restore-nsec-submit")!.addEventListener("click", async () => {
      const nsec = (document.getElementById("restore-nsec") as HTMLInputElement).value.trim();
      const errEl = document.getElementById("restore-nsec-error")!;
      try {
        const identity = identityFromNsec(nsec);
        await proceedAfterRestore(fullContainer, identity, onReady);
      } catch {
        errEl.textContent = "That doesn't look like a valid key.";
        errEl.style.display = "block";
      }
    });
  });
}
