import { fetchGlobalFeed, type FeedItem } from "../lib/directory";
import { nip19 } from "nostr-tools";
import { escapeHtml } from "../util";

export async function renderFeed(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
      <div>
        <h1 class="page-title">Feed</h1>
        <p class="page-sub">Recent public credits from across the network — festivals, conferences, sporting events, all of it. Private credits never appear here.</p>
      </div>
      <button class="btn btn-outline btn-sm" id="feed-refresh-btn">Refresh</button>
    </div>
    <div id="feedList" class="loading">Loading from relays…</div>
  `;

  document.getElementById("feed-refresh-btn")!.addEventListener("click", () => loadFeed(true));
  await loadFeed(false);
}

async function loadFeed(forceFresh: boolean): Promise<void> {
  const listEl = document.getElementById("feedList")!;
  listEl.className = "loading";
  listEl.textContent = "Loading from relays…";

  let items: FeedItem[] = [];
  try {
    items = await fetchGlobalFeed(undefined, forceFresh);
  } catch {
    listEl.className = "";
    listEl.innerHTML = `<div class="error-box">Couldn't reach any relay. <button class="icon-btn" id="feed-retry-btn">Try again</button></div>`;
    document.getElementById("feed-retry-btn")?.addEventListener("click", () => loadFeed(true));
    return;
  }
  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <h3>Nothing here yet.</h3>
        <p>Be the first — add a public credit and it'll show up for everyone.</p>
        <a href="#/credits/add" class="btn btn-primary">Add a credit</a>
      </div>`;
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const npub = nip19.npubEncode(item.authorPubkey);
      const displayName = item.authorName ? escapeHtml(item.authorName) : "Unnamed crew member";
      return `
      <div class="feed-item">
        <div class="feed-author">
          <a href="#/profile/${npub}">${displayName}</a> logged a credit
        </div>
        <div class="credit-event">
          ${escapeHtml(item.content.eventName)}
          ${item.verified ? `<span class="verified-badge">Verified</span>` : ""}
        </div>
        <div class="credit-role">${escapeHtml(item.content.role)}</div>
        <div class="credit-type-tag">${escapeHtml(item.content.eventType)} · ${item.content.year}${item.content.endYear ? "–" + item.content.endYear : ""}</div>
        ${item.content.description ? `<div class="credit-desc">${escapeHtml(item.content.description)}</div>` : ""}
        ${item.confirmedBy.length ? `<div class="confirmed-by">${item.confirmedBy.length} verification${item.confirmedBy.length === 1 ? "" : "s"}</div>` : ""}
      </div>
    `;
    })
    .join("");
}
