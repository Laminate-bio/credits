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

## How the pieces fit together

```
src/lib/
  schema.ts        Event kind numbers + TypeScript types for the data model
  identity.ts       Keypair generation, encoding (npub/nsec), local storage
  credentials.ts    Build + sign credits, confirmations, org offers/claims
  relay.ts          Publish/query/subscribe against Nostr relays
  directory.ts      High-level "fetch someone's resume with live verification
                     status" — this is what the UI actually calls
```

Everything is built on [Nostr](https://nostr.com) — a simple, open protocol
for signed events + relays. We're using it here as a general-purpose
signed-event bus, not for its social-networking features. `nostr-tools` is
the reference JS/TS library.

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

Open the local URL Vite prints. The demo UI in `index.html` / `src/main.ts`
exercises the whole loop: create an identity, add a credit, look up someone
else's npub and confirm one of their credits, and — in the "event organizer
demo" section — issue and claim a credential offer end to end.

This UI is intentionally bare — a functional test harness for the protocol
layer, not the real product. **The visual design already exists** as a
polished single-file HTML prototype (the "laminate pass" resume look,
directory search, printable resume view) from earlier in this project —
port that UI to call into `src/lib/*` instead of local/artifact storage.
That's the natural next step.

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

- [ ] Port the existing pass/directory/resume UI to this protocol layer
- [ ] Pick a real key-storage approach (NIP-07 extension support at minimum;
      encrypted local storage as a fallback for people without one)
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
- [ ] Design social/threshold recovery for lost keys — a real UX problem
      for a non-crypto-native audience

## License

AGPL-3.0. Chosen deliberately: if someone forks this and runs a modified
version as a network service (a hosted version, a competing app), they're
required to release their changes too. Full text:
https://www.gnu.org/licenses/agpl-3.0.txt — add it verbatim as `LICENSE`
when you push this to a real repo (GitHub does this automatically when you
select a license during repo creation).
