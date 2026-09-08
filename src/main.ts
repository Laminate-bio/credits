import type { Identity } from "./lib/identity";
import {
  createIdentity,
  loadIdentityLocally,
  saveIdentityLocally,
  identityFromNsec,
} from "./lib/identity";
import type { CreditContent, CredentialOfferContent, EventType } from "./lib/schema";
import {
  signCredit,
  newCreditId,
  signConfirmation,
  retractConfirmation,
  signCredentialOffer,
  claimOffer,
} from "./lib/credentials";
import { publishEvent } from "./lib/relay";
import { fetchResumeFor, fetchOfferByClaimCode, VERIFICATION_THRESHOLD } from "./lib/directory";
import { nip19 } from "nostr-tools";

// --- Personal identity setup -------------------------------------------------

let me: Identity | null = loadIdentityLocally();

const identityDisplay = document.getElementById("identityDisplay")!;

function renderIdentity() {
  if (!me) {
    identityDisplay.innerHTML = `
      <p class="muted">No identity on this device yet. Your identity IS a keypair — creating one is instant, no signup form.</p>
      <button id="create-identity">Create my identity</button>
      <p class="muted">or restore an existing one:</p>
      <input id="restore-nsec" placeholder="nsec1..." style="width:70%" />
      <button id="restore-identity">Restore</button>
    `;
    document.getElementById("create-identity")!.addEventListener("click", () => {
      me = createIdentity();
      saveIdentityLocally(me);
      alert(
        "Save this key somewhere safe — it's the only way to recover your identity if you clear this browser:\n\n" +
          me.nsec
      );
      renderIdentity();
      showAppSections();
    });
    document.getElementById("restore-identity")!.addEventListener("click", () => {
      const nsec = (document.getElementById("restore-nsec") as HTMLInputElement).value.trim();
      try {
        me = identityFromNsec(nsec);
        saveIdentityLocally(me);
        renderIdentity();
        showAppSections();
      } catch (e) {
        alert("That didn't look like a valid nsec key.");
      }
    });
    return;
  }

  identityDisplay.innerHTML = `
    <p>Signed in as:</p>
    <div class="mono">${me.npub}</div>
    <button id="show-nsec">Show my backup key</button>
    <button id="forget-identity">Forget this identity (local only)</button>
  `;
  document.getElementById("show-nsec")!.addEventListener("click", () => {
    alert("Your private key — never share this:\n\n" + me!.nsec);
  });
  document.getElementById("forget-identity")!.addEventListener("click", () => {
    if (confirm("This only clears the key from this browser. If you haven't backed it up, you'll lose access to this identity permanently. Continue?")) {
      localStorage.removeItem("laminate:nsec");
      me = null;
      renderIdentity();
      hideAppSections();
    }
  });
  showAppSections();
}

function showAppSections() {
  ["addCreditSection", "myResumeSection", "lookupSection", "orgSection"].forEach((id) => {
    document.getElementById(id)!.style.display = "block";
  });
}
function hideAppSections() {
  ["addCreditSection", "myResumeSection", "lookupSection", "orgSection"].forEach((id) => {
    document.getElementById(id)!.style.display = "none";
  });
}

renderIdentity();

// --- Add a credit -------------------------------------------------------------

document.getElementById("cf-save")!.addEventListener("click", async () => {
  if (!me) return;
  const status = document.getElementById("cf-status")!;
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
    status.textContent = "Event name, role, and year are required.";
    return;
  }
  status.textContent = "Signing & publishing…";
  const event = signCredit(me, newCreditId(), content);
  try {
    await publishEvent(event);
    status.textContent = "Published. Refresh your credits below to see it.";
  } catch (e) {
    status.textContent = "Couldn't reach any relay — check your connection and try again.";
  }
});

// --- My credits -----------------------------------------------------------

document.getElementById("refreshMine")!.addEventListener("click", async () => {
  if (!me) return;
  const container = document.getElementById("myCredits")!;
  container.innerHTML = "Loading…";
  const resume = await fetchResumeFor(me.pubkey);
  renderCredits(container, resume, { showConfirmButton: false });
});

// --- Look up someone else -------------------------------------------------

document.getElementById("lookup-btn")!.addEventListener("click", async () => {
  const npub = (document.getElementById("lookup-npub") as HTMLInputElement).value.trim();
  const results = document.getElementById("lookupResults")!;
  let pubkey: string;
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== "npub") throw new Error();
    pubkey = decoded.data as string;
  } catch {
    results.innerHTML = `<p class="muted">That doesn't look like a valid npub.</p>`;
    return;
  }
  results.innerHTML = "Loading…";
  const resume = await fetchResumeFor(pubkey);
  renderCredits(results, resume, { showConfirmButton: true, ownerPubkey: pubkey });
});

function renderCredits(
  container: HTMLElement,
  resume: Awaited<ReturnType<typeof fetchResumeFor>>,
  opts: { showConfirmButton: boolean; ownerPubkey?: string }
) {
  if (resume.length === 0) {
    container.innerHTML = `<p class="muted">No credits found on the connected relays yet.</p>`;
    return;
  }
  container.innerHTML = resume
    .map(
      (c, i) => `
    <div class="credit-card">
      <b>${escapeHtml(c.content.eventName)}</b>
      ${c.verified ? `<span class="badge">Verified</span>` : ""}
      <div class="muted">${escapeHtml(c.content.role)} · ${escapeHtml(c.content.eventType)} · ${c.content.year}${c.content.endYear ? "–" + c.content.endYear : ""}</div>
      ${c.content.description ? `<div>${escapeHtml(c.content.description)}</div>` : ""}
      <div class="muted">${c.confirmedBy.length} confirmation${c.confirmedBy.length === 1 ? "" : "s"} (need ${VERIFICATION_THRESHOLD} to verify)</div>
      ${opts.showConfirmButton ? `<button data-idx="${i}" class="confirm-btn">I was there too — confirm</button>` : ""}
    </div>
  `
    )
    .join("");

  if (opts.showConfirmButton) {
    container.querySelectorAll<HTMLButtonElement>(".confirm-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!me) return;
        const idx = parseInt(btn.dataset.idx!, 10);
        btn.disabled = true;
        btn.textContent = "Signing…";
        const event = signConfirmation(me, resume[idx].event, {});
        await publishEvent(event);
        btn.textContent = "Confirmed ✓";
      });
    });
  }
}

// --- Org demo: separate identity, offer, claim -----------------------------

let org: Identity | null = null;
try {
  const raw = localStorage.getItem("laminate:nsec:org-demo");
  if (raw) org = identityFromNsec(raw);
} catch {}

const orgIdentityDisplay = document.getElementById("orgIdentityDisplay")!;
function renderOrgIdentity() {
  if (!org) {
    orgIdentityDisplay.innerHTML = `<button id="create-org">Create a demo org identity</button>`;
    document.getElementById("create-org")!.addEventListener("click", () => {
      org = createIdentity();
      localStorage.setItem("laminate:nsec:org-demo", org.nsec);
      renderOrgIdentity();
    });
  } else {
    orgIdentityDisplay.innerHTML = `<div class="mono">Org pubkey: ${org.npub}</div>`;
  }
}
renderOrgIdentity();

document.getElementById("of-issue")!.addEventListener("click", async () => {
  if (!org) return;
  const status = document.getElementById("of-status")!;
  const content: CredentialOfferContent = {
    recipientLabel: (document.getElementById("of-recipient") as HTMLInputElement).value.trim(),
    claimCode: (document.getElementById("of-claimcode") as HTMLInputElement).value.trim(),
    eventName: (document.getElementById("of-eventName") as HTMLInputElement).value.trim(),
    role: (document.getElementById("of-role") as HTMLInputElement).value.trim(),
    eventType: "Music Festival",
    year: parseInt((document.getElementById("of-year") as HTMLInputElement).value, 10),
  };
  if (!content.claimCode || !content.eventName || !content.role || !content.year) {
    status.textContent = "Claim code, event name, role, and year are required.";
    return;
  }
  status.textContent = "Signing & publishing offer…";
  const event = signCredentialOffer(org, crypto.randomUUID(), content);
  await publishEvent(event);
  status.textContent = `Offer published. Give the claim code "${content.claimCode}" to the worker.`;
});

document.getElementById("claim-btn")!.addEventListener("click", async () => {
  if (!me) {
    alert("Create your personal identity above first — that's whose profile the credit will belong to.");
    return;
  }
  const status = document.getElementById("claim-status")!;
  const code = (document.getElementById("claim-code-input") as HTMLInputElement).value.trim();
  if (!code) return;
  status.textContent = "Searching relays for this claim code…";
  const offerEvent = await fetchOfferByClaimCode(code);
  if (!offerEvent) {
    status.textContent = "No offer found with that claim code.";
    return;
  }
  const offerContent = JSON.parse(offerEvent.content) as CredentialOfferContent;
  const creditEvent = claimOffer(me, offerEvent, offerContent);
  await publishEvent(creditEvent);
  status.textContent = "Claimed! It's now a credit signed by you — refresh your credits above to see it.";
});

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}
