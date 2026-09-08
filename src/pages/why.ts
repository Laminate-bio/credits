export function renderWhyPage(container: HTMLElement): void {
  container.innerHTML = `
    <a href="#/" class="back-link" style="display:inline-block;margin-bottom:20px;font-size:14px;color:var(--graphite);">‹ Back to the feed</a>
    <h1 class="page-title">Why we built this</h1>
    <div class="prose-page">
      <p>If you've ever worked a festival, run a conference floor, or crewed a game day, you know the work is real — skilled, exhausting, often invisible, and almost never written down anywhere that lasts. A LinkedIn title doesn't capture what it means to have run monitors for three days straight or held a credentialing desk together during a gate rush. And nothing like IMDb exists for the people who build the show instead of appearing in it.</p>
      <p>So credit for this work tends to live in group chats, old contracts, and other people's memories — which disappears the moment those people move on. We wanted something closer to a real, lasting record: log what you've actually worked, have the people who were there with you vouch for it, and own that record yourself instead of renting it from a platform that could disappear or change the rules on you.</p>
      <p>That's why this runs the way it does under the hood. Your identity is a key you hold, not an account we control. Credits are signed by you and confirmed by peers, not approved by us. It's open source on purpose — if we ever get this wrong, anyone can fork it and keep going without us.</p>
      <p>Still early, still rough in places. If you're reading this, you're probably one of the first people using it — thank you for that.</p>
    </div>
  `;
}
