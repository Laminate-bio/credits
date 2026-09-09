import { nip19 } from "nostr-tools";
import { fetchProfile, fetchResumeFor, type ResolvedCredit } from "../lib/directory";
import { state } from "../state";
import { escapeHtml } from "../util";
import { buildReel, recordReel, getFormatDimensions, REEL_CREDIT_CAP, type ReelFormat } from "../lib/videoReel";

export async function renderReelPage(container: HTMLElement, npub: string): Promise<void> {
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
    <a href="#/credits/${npub}" class="btn btn-outline btn-sm" style="margin-bottom:20px;">‹ Back to credits</a>
    <h1 class="page-title">Generate a credits video</h1>
    <p class="page-sub">No one can see the stack of laminates on your desk. Share your credit reel!</p>
    <div id="reelBody" class="loading">Loading your credits…</div>
  `;

  const body = document.getElementById("reelBody")!;
  const profile = await fetchProfile(pubkey);
  let resume: ResolvedCredit[];
  try {
    resume = await fetchResumeFor(pubkey, state.me);
  } catch {
    body.innerHTML = `<div class="error-box">Couldn't reach any relay. Check your connection and refresh.</div>`;
    return;
  }

  const publicCredits = resume.filter((c) => !c.isPrivate);
  const privateCount = resume.length - publicCredits.length;

  if (!profile?.name) {
    body.innerHTML = `<div class="empty-state"><h3>No profile name set.</h3><p>Set up a name on the profile page first — it's the headline of the video.</p>${isOwner ? `<a href="#/profile/edit" class="btn btn-primary">Set up your name</a>` : ""}</div>`;
    return;
  }

  const pageHeader = container.querySelector(".page-title")!;
  pageHeader.textContent = `${profile.name}'s credits video`;

  if (publicCredits.length === 0 && !(isOwner && privateCount > 0)) {
    body.innerHTML = `<div class="empty-state"><h3>No credits to show yet.</h3><p>Add at least one to generate a video.</p><a href="#/credits/add" class="btn btn-primary">Add a credit</a></div>`;
    return;
  }

  let selectedFormat: ReelFormat = "vertical";
  let includePrivate = false;

  body.innerHTML = `
    <div class="card">
      <div class="form-row">
        <label>Format</label>
        <div class="visibility-toggle">
          <div class="visibility-option selected" data-format="vertical">Vertical (9:16)<small>Reels, TikTok, Stories</small></div>
          <div class="visibility-option" data-format="square">Square (1:1)<small>Feed posts</small></div>
        </div>
      </div>
      ${isOwner && privateCount > 0 ? `
        <div class="form-row">
          <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;">
            <input type="checkbox" id="include-private">
            Include my ${privateCount} private credit${privateCount === 1 ? "" : "s"} in this video
          </label>
          <p class="muted" style="margin-top:4px;">Only you can generate this — private credits still won't appear anywhere public unless you post this video yourself.</p>
        </div>
      ` : ""}
      ${publicCredits.length + (isOwner ? privateCount : 0) > REEL_CREDIT_CAP ? `<p class="muted">Showing your ${REEL_CREDIT_CAP} most recent credits to keep the video a reasonable length.</p>` : ""}
      <p class="muted">Downloads as .webm — plays fine on most platforms. If somewhere specifically needs .mp4, a free online converter handles that in one extra step.</p>
      <div class="form-actions">
        <button class="btn btn-primary" id="generate-btn">Generate video</button>
      </div>
    </div>
    <div id="renderArea"></div>
  `;

  body.querySelectorAll<HTMLElement>(".visibility-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      selectedFormat = opt.dataset.format as ReelFormat;
      body.querySelectorAll(".visibility-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
    });
  });

  document.getElementById("include-private")?.addEventListener("change", (e) => {
    includePrivate = (e.target as HTMLInputElement).checked;
  });

  document.getElementById("generate-btn")!.addEventListener("click", async () => {
    const creditsForReel = includePrivate ? resume : publicCredits;
    await runGeneration(profile.name, profile.title, creditsForReel, selectedFormat);
  });
}

async function runGeneration(name: string, title: string | undefined, credits: ResolvedCredit[], format: ReelFormat): Promise<void> {
  const renderArea = document.getElementById("renderArea")!;
  const dims = getFormatDimensions(format);

  renderArea.innerHTML = `
    <div class="card">
      <p class="muted" id="reel-status">Laying out the credits…</p>
      <canvas id="reel-canvas" style="width:100%;max-width:${format === "vertical" ? "320px" : "420px"};aspect-ratio:${dims.width}/${dims.height};background:#000;border-radius:8px;display:block;margin:12px 0;"></canvas>
      <div id="reel-result"></div>
    </div>
  `;

  const statusEl = document.getElementById("reel-status")!;
  const canvas = document.getElementById("reel-canvas") as HTMLCanvasElement;

  try {
    const { canvas: offscreen, scrollDistance, durationMs } = await buildReel({ name, title, credits }, format);
    statusEl.textContent = `Recording — this takes about ${Math.round(durationMs / 1000)}s in real time, playing right here as it records…`;

    const blob = await recordReel(canvas, offscreen, scrollDistance, durationMs, format, (t) => {
      statusEl.textContent = `Recording… ${Math.round(t * 100)}%`;
    });

    const url = URL.createObjectURL(blob);
    statusEl.textContent = "Done. Preview it below before downloading.";
    document.getElementById("reel-result")!.innerHTML = `
      <video src="${url}" controls style="width:100%;max-width:${format === "vertical" ? "320px" : "420px"};border-radius:8px;margin-top:10px;"></video>
      <div class="form-actions">
        <a class="btn btn-primary" href="${url}" download="laminate-credits-${slugForFilename(name)}.webm">Download video</a>
      </div>
    `;
  } catch (err) {
    statusEl.textContent = "Something went wrong generating the video — your browser may not support recording canvas video. Try the latest Chrome, Firefox, or Edge.";
  }
}

function slugForFilename(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "credits";
}
