# Laminate

An open-source, peer-to-peer credits network and resume builder for event
industry crew — music festivals, conferences, sporting events, and everything
backstage. Log the events you've worked, get peer-confirmed by people who
were actually there, and eventually receive verified credits directly from
event organizers.

## Why this architecture

There's no login system, no account database, and no company that can
suspend your profile. Your identity **is** a cryptographic keypair. Your
credits and confirmations are signed events, not database rows — anyone can
verify them independently, and nobody (including whoever runs a relay) can
forge or silently edit them.

This trades away some conveniences a normal web app gets for free:

- **No password reset.** If you lose your private key, you lose the
  identity. See `src/lib/identity.ts` for the current (intentionally basic)
  local-storage approach and notes on better options (NIP-07 browser
  extensions, encrypted local storage, or social recovery).
- **No single "the directory."** Search/discovery depends on which relays
  you're querying. This is by design — no single relay operator controls
  the network — but it means directory completeness depends on relay
  coverage, which is worth monitoring as this grows.
- **Moderation is your job, not a platform's.** There's no admin who can
  delete a fake account. Client-side filtering/reporting and, eventually,
  reputation systems fill this gap — not built yet.

In exchange: it's genuinely peer-to-peer, genuinely open, and nobody but the
person holding a given key can act as that identity — including issuing
fraudulent confirmations or editing someone else's credits.

## Identity, made less cryptic

Earlier versions of this asked people to save a raw `nsec1...` string —
technically correct, but a genuinely alien thing to hand a non-technical
person. Identity now uses **NIP-06**: a real standard where your key is
derived from a 12-word recovery phrase (`src/lib/identity.ts`), the same
mental model as a crypto wallet seed phrase, but plain English words
instead of a code string. Creating an identity shows this phrase on a
proper in-page screen (not a blocking `alert()`), with a checkbox
confirming it's been saved before continuing. It can be viewed again
later from Profile → Edit → "Advanced: your keys."

Because it's a standard (not a Laminate-specific trick), the same phrase
works in any other NIP-06-compatible Nostr client — this project isn't
a lock-in.

The peer-confirmation mechanic — two people vouching for the same
credit — is unchanged; only the key-handling UX around it got friendlier.

## How the pieces fit together

```
src/lib/
  schema.ts        Event kind numbers + TypeScript types for the data model
  identity.ts       NIP-06 mnemonic-based identity: create/restore via a
                     12-word phrase, encode as npub/nsec for interop
  credentials.ts    Build + sign credits, confirmations, org offers/claims,
                     profiles, and self-encryption for private credits
  relay.ts          Publish/query/subscribe against Nostr relays
  directory.ts       "Fetch someone's resume," "fetch the global feed" —
                     the high-level reads the UI actually calls
src/pages/
  nav.ts             Shared nav bar, dark mode toggle, identity chip
  identityGate.ts     "Create/restore your identity" prompt, reused by any
                      page that requires signing
  feed.ts            Public feed — recent public credits from everyone
  profile.ts          View anyone's bio/pass; edit your own (two routes,
                      deliberately separate pages)
  credits.ts           View a profile's credit list, confirm others',
                       edit your own
  addCredit.ts          Standalone "add a credit" page, with the
                        public/private choice
  organizer.ts           Event-organizer flow: upload a staff-list
                          spreadsheet, map columns, preview, and
                          bulk-publish credential offers
src/lib/xlsxImport.ts   Spreadsheet parsing (read-excel-file), header
                        auto-detection, and offer-row building
  reel.ts                Generate-a-shareable-video page
  resumeImport.ts        Resume-upload review page (lazy-loaded — see
                         note below)
src/lib/videoReel.ts     Canvas rendering + MediaRecorder capture for
                         the credits-roll video
src/lib/resumeParse.ts  Resume text extraction (pdfjs-dist, mammoth),
                        segmentation, and event/non-event classification
src/main.ts           Hash router wiring all of the above together
src/style.css          Shared styles, full light/dark theme via CSS
                        variables under [data-theme="dark"]
```

### Routes

| Route | Page |
|---|---|
| `#/` | Public feed |
| `#/profile` | Your own profile (prompts identity setup if needed) |
| `#/profile/<npub>` | Someone else's profile |
| `#/profile/edit` | Edit your bio/title/location/skills |
| `#/credits/<npub>` | A profile's credit list (confirm others', edit your own) |
| `#/credits/add` | Add a new credit, choosing public or private |
| `#/credits/import` | Bulk-import candidate credits from an uploaded resume |
| `#/reel/<npub>` | Generate a downloadable credits video |
| `#/organizer` | Event-organizer offer/claim demo |

`#/credits/import` is lazy-loaded (`import("./pages/resumeImport")` in
`main.ts`) rather than bundled into the main entry point — `pdfjs-dist`
and `mammoth` add real weight (~260KB gzipped), and there's no reason
everyone browsing the feed should pay that cost. If you add other
heavy, occasionally-used dependencies later, follow the same pattern.

Everything is built on [Nostr](https://nostr.com) — a simple, open protocol
for signed events + relays. We're using it here as a general-purpose
signed-event bus, not for its social-networking features. `nostr-tools` is
the reference JS/TS library.

### Public vs. private credits

"Private" is implemented as real encryption, not just "don't show this in
the UI." A private credit is encrypted with `nip44` using a
**self-conversation key** (your own key talking to your own pubkey) before
it's published — the event still syncs across your devices via relays,
but nobody without your private key, including whoever runs the relay,
can read what's inside.

The trade-off, and it's a real one: **a private credit can't be
peer-confirmed**, because nobody else can read it to confirm it. That's
inherent to the privacy guarantee, not a missing feature. The feed
(`fetchGlobalFeed` in `directory.ts`) only ever surfaces public credits —
private ones fail to parse as plain JSON and get filtered out even before
the privacy tag is checked, as defense in depth.

### Bulk-issuing from a spreadsheet

The organizer flow (`#/organizer`) takes an `.xlsx` staff list directly —
no manual one-row-at-a-time form. It:

1. Reads the header row and guesses which column is which (name/email →
   recipient, "Event"/"Festival" → event name, "Role"/"Title" → role,
   etc. — see `FIELD_SYNONYMS` in `xlsxImport.ts`) using simple keyword
   matching, then shows the guessed mapping for the organizer to confirm
   or override.
2. Lets the organizer choose what happens to columns that aren't mapped
   to a known field: fold them into each offer's `description` (one
   line per column, or comma-separated), or drop them.
3. Shows a preview — including which rows got skipped for missing a
   required field — before anything is signed or published.
4. Publishes one `CREDENTIAL_OFFER` event per row, then generates a
   downloadable CSV of claim codes so the organizer can distribute them
   (email, text, printed badges) through whatever channel they already use.

We deliberately used [`read-excel-file`](https://www.npmjs.com/package/read-excel-file)
rather than the more commonly-recommended `xlsx` (SheetJS) package —
SheetJS stopped publishing security patches to npm after a licensing
dispute, and the npm-published version has open, unpatched
vulnerabilities. `read-excel-file` is purpose-built for reading (which
is all we need here) and has none.

### Generating a shareable credits video

`#/reel/<npub>`, linked from the credits page, renders a scrolling
movie-style credits roll — name, title, then every credit — entirely in
the browser (`src/lib/videoReel.ts`), and records it with the browser's
native `MediaRecorder` API. Nothing is uploaded anywhere; the video never
leaves the device except as the file the person downloads.

**This exports `.webm`, not `.mp4`.** Getting a browser to produce real
`.mp4` means shipping an ffmpeg build compiled to WebAssembly (25MB+) and
usually needs cross-origin-isolation headers a plain static host like
GitHub Pages doesn't set by default. `.webm` plays fine on most
platforms; where it doesn't, a free online converter is one extra step.
Worth revisiting if that trade-off ever stops being acceptable.

Private credits are excluded by default (the whole point is sharing
externally) but the owner can opt to include them for a personal-only
export. Credits are capped at 60 per video to keep runtime reasonable.

Browser support caveat: `canvas.captureStream()` + `MediaRecorder` is
solid in current Chrome/Firefox/Edge; Safari's support has historically
been inconsistent. Test on whatever browsers your actual users are on
before relying on this working everywhere.

### Making sure people actually have names

Early on it was possible to create an identity and immediately post
credits and confirmations without ever setting a name — the feed and
credit pages had nothing to show but a cryptic pubkey for that person,
which defeats the point of an app about showing off your work.
Identity creation and restore now route through a name-setting step by
default (`showNameStep` in `identityGate.ts`) before handing control
back to whatever page asked for identity in the first place. It's
skippable — nobody's forced — but skipping is the exception, not
something you fall into by accident. `fetchDisplayName()` in
`directory.ts` is the one place that decides the fallback for someone
who skipped anyway ("Unnamed crew member," never a raw hex string),
used consistently across the feed, credits page, and video generator.

### Importing credits from a resume

`#/credits/import`, linked from the add-credit page, lets someone
upload a resume (`.pdf`, `.docx`, or `.txt`) and pulls out candidate
event-industry credits instead of typing each one by hand. Parsing
(`src/lib/resumeParse.ts`) happens entirely in the browser — the resume
is never uploaded anywhere, and nothing from it is signed or published
except what the person explicitly approves on the review screen.

This is **keyword matching, not AI** — there's no model doing semantic
understanding, just pattern matching against event-industry terms, and
it's deliberately conservative:

- **"Event"** — matched a specific event-industry keyword (a role like
  "stage manager," a term like "music festival"). Pre-filled as an
  editable draft, but still requires the person to hit publish — not
  auto-published.
- **"Ambiguous"** — some weak signal (venue words, generic terms like
  "coordinator") that isn't enough to be confident. Never becomes a
  draft credit on its own — the person is asked directly "is this an
  event, or not?" and only a "yes" turns it into something reviewable.
- **"Non-event"** — no event-industry signal at all. Excluded by
  default and not shown as a credit candidate — collapsed behind an
  explicit "show what was excluded" toggle so the person can catch a
  false negative, but nothing here is ever pre-selected to publish.

The actual guarantee that non-event work never ends up visible on the
site doesn't come from the classifier being perfect (it isn't) — it
comes from every single entry, in every bucket, requiring an explicit
human approval before anything gets signed. The classifier's only job
is deciding what gets asked about versus what's excluded by default;
final judgment always stays with the person.

### Branding: backgrounds and the "why" page

`src/assets/laminate-bg-light.webp` and `laminate-bg-dark.webp` are the
theme backgrounds, swapped via the same `[data-theme="dark"]` mechanism
as everything else (see `body` rules in `style.css`). They were
converted from PNG to WebP during setup — same visual quality, about
1% of the file size (1.7MB → ~13KB each), which matters since this
loads on every single page view, unlike the lazy-loaded resume-import
libraries. If you swap in new background art later, convert it the
same way before committing it:
```
convert your-new-bg.png -quality 82 your-new-bg.webp
```

The footer link "Why we built this" (`#/why`, `src/pages/why.ts`) is
intentionally quiet — not in the main nav, but present on every page
for anyone who goes looking. The current copy is a first draft written
from the conversation that shaped this project; it's meant to be
rewritten in the actual founder's own words, not shipped as-is.

### Color contrast (WCAG AA)

Three real bugs got fixed here, not just a vibe check:

1. **Dark mode text was invisible on the profile pass and header.** Both
   reused `--paper` for "light text color," which coincidentally worked
   in light mode but broke once dark mode redefined `--paper` to mean
   "dark page background" — dark text on a dark card. Fixed with a
   dedicated `--on-dark-text` variable that never flips with theme,
   used only by components that are always dark regardless of site
   theme (the header bar, the pass card).
2. **Dark-mode error text had a stray alpha channel** (`#E2776399` —
   the trailing `99` is opacity, not part of the color), making it
   semi-transparent and low-contrast against whatever sat behind it.
3. **`--graphite-light` (used for hints, "Confirmed by...", the footer
   link) failed 4.5:1 in both themes** — measured ~3.7:1 light,
   ~4.3:1 dark. Adjusted until it cleared 4.5:1 with real margin in
   both.

If you change any of the theme colors in `style.css` going forward,
check contrast before committing rather than trusting the screen —
[WebAIM's contrast checker](https://webaim.org/resources/contrastchecker/)
is free and takes ten seconds per pair.

### The credit lifecycle

1. **You sign a credit yourself** (`signCredit`) — event name, role, type,
   year. This is unverified by default, same as a self-reported LinkedIn
   entry.
2. **A peer who was also there signs a confirmation** (`signConfirmation`)
   pointing at your credit. At 2+ active confirmations
   (`VERIFICATION_THRESHOLD` in `directory.ts`), the credit shows as
   **Verified** — see `fetchResumeFor`.
3. **Down the line: an event organizer bulk-issues credits.** The org signs
   a batch of `CREDENTIAL_OFFER` events (`signCredentialOffer`) — one per
   staff member, matched to a claim code the org sends out-of-band (email,
   text, printed badge). This is deliberately **not** a credit yet. A
   worker finds their offer by claim code (`fetchOfferByClaimCode`) and
   signs their own `CREDIT` event referencing it (`claimOffer`). The org
   never writes directly to anyone's profile — every credit that appears
   anywhere is signed by the person it belongs to.

This mirrors how the [Open Badges](https://openbadges.org) standard and
[W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model/) handle
issuer → claim flows. Worth reading both before extending this further —
no need to reinvent conventions that already exist.

## Running it

```bash
npm install
npm run dev
```

Open the local URL Vite prints. This is now a real multi-page app:

- **Feed** (`/`) — browse recent public credits from everyone
- **My profile** — create your identity, set up your bio, and see your pass
- **Add a credit** — log one, choosing public or private
- **For organizers** — the bulk-issue / claim-by-code demo, on its own page

Dark mode is a toggle in the top-right of the nav, persisted per-browser.

This is real UI now, not just a protocol test harness — but it's still
intentionally plain (no illustrations, minimal chrome) rather than a fully
polished brand experience. Visual refinement (richer pass styling,
imagery, animation) is a reasonable next layer on top of this.

## Hosting it for free

The whole frontend is static files — no server, no database, because all
the real work happens over Nostr relays. Any free static host works.

**GitHub Pages (recommended to start):** already wired up.
1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set the source to "GitHub Actions."
3. Push to `main` — `.github/workflows/deploy.yml` builds and deploys
   automatically. Your site will be live at
   `https://yourusername.github.io/laminate/` at no cost.

No custom domain is required — that free subdomain works indefinitely. If
you want your own domain later, any registrar runs roughly $10–15/year;
point its DNS at GitHub Pages (or Cloudflare/Netlify Pages, both also free)
whenever you're ready.

For a more censorship-resistant home once there's real traffic worth
protecting, pin the same `dist/` build to IPFS (e.g. via
[Fleek](https://fleek.xyz) or [web3.storage](https://web3.storage)) as a
second, no-single-owner mirror — `vite.config.ts` already uses relative
asset paths so the exact same build works there unmodified.

## Roadmap / open questions

- [ ] A searchable directory (by name/role/location) — the feed shows
      recent activity, but there's no way yet to browse everyone, only
      people whose npub you already have or who show up in the feed
- [ ] Port over the printable/PDF resume view from the earlier prototype
- [ ] Pick a real key-storage-at-rest approach — the recovery phrase now
      makes *backup* friendly, but the key still sits in localStorage in
      the clear on the device itself. NIP-07 browser extension support
      (Alby, nos2x) or encrypted local storage are the next steps
- [ ] Social/threshold recovery as an alternative to "if you lose the
      12 words, the identity is gone" — a real UX cliff for a
      non-crypto-native audience, even with a friendlier phrase
- [ ] Write up the event kinds in `schema.ts` as a proper NIP doc so other
      clients could interoperate — right now the kind numbers are
      provisional and only documented in code comments
- [ ] Decide on org verification (domain proof? community approval queue?
      both?) before the organizer-issuance flow goes live for real
- [ ] Consider running a dedicated community relay (open-source options:
      [strfry](https://github.com/hoytech/strfry),
      [nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay)) alongside
      public defaults, so the network doesn't fully depend on relays this
      project doesn't control
- [ ] A real "delete" story — the credit/confirmation model here is
      append-only (edit = re-sign, not erase). NIP-09 deletion events
      are the standard next step, advisory-only since relays aren't
      obligated to actually purge anything

## License

AGPL-3.0. Chosen deliberately: if someone forks this and runs a modified
version as a network service (a hosted version, a competing app), they're
required to release their changes too. Full text:
https://www.gnu.org/licenses/agpl-3.0.txt — add it verbatim as `LICENSE`
when you push this to a real repo (GitHub does this automatically when you
select a license during repo creation).
