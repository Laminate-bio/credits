/**
 * credentials.ts
 * -----------------------------------------------------------------------
 * Turns the schema types into actual signed Nostr events, and back.
 * This is the layer that makes trust cryptographic instead of
 * "whoever has write access to the database wins."
 * -----------------------------------------------------------------------
 */

import { finalizeEvent, verifyEvent, nip44, type Event, type UnsignedEvent } from "nostr-tools";
import { KIND, PRIVATE_TAG, EVENT_TYPES } from "./schema";
import type {
  CreditContent,
  ConfirmationContent,
  OrgProfileContent,
  ProfileContent,
  CredentialOfferContent,
} from "./schema";
import type { Identity } from "./identity";

export type Visibility = "public" | "private";

/**
 * Self-encryption: derive a nip44 conversation key between your own key
 * and your own pubkey. Only someone holding your private key can ever
 * decrypt the result — that's what makes a "private" credit genuinely
 * private rather than just unlisted on a public relay.
 */
function selfConversationKey(identity: Identity): Uint8Array {
  return nip44.getConversationKey(identity.secretKey, identity.pubkey);
}

/** Build and sign a standard kind-0 profile (bio, title, location, skills). */
export function signProfile(identity: Identity, content: ProfileContent): Event {
  const unsigned: UnsignedEvent = {
    kind: KIND.PROFILE,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(content),
  };
  return finalizeEvent(unsigned, identity.secretKey);
}

/** Every credit needs a stable id so it can be edited (replaced) or referenced by confirmations. Call this once when a credit is first created, then keep reusing it. */
export function newCreditId(): string {
  return crypto.randomUUID();
}

/**
 * Build and sign a CREDIT event.
 * Re-signing with the same `creditId` (used as the NIP-33 "d" tag)
 * replaces the previous version on relays that honor NIP-33 — this is
 * how "editing a credit" works without a central UPDATE statement.
 *
 * `visibility: "private"` self-encrypts the content with nip44 before
 * publishing. The event still goes out to relays (so it syncs across
 * your own devices), but nobody without your private key — including
 * relay operators — can read what's inside. Trade-off: a private
 * credit can't be peer-confirmed by anyone else, since nobody else can
 * read it to confirm it. That's inherent to the privacy guarantee, not
 * a bug to work around.
 */
export function signCredit(
  identity: Identity,
  creditId: string,
  content: CreditContent,
  visibility: Visibility = "public"
): Event {
  const tags = [["d", creditId]];
  let eventContent: string;

  if (visibility === "private") {
    tags.push([PRIVATE_TAG, "true"]);
    eventContent = nip44.encrypt(JSON.stringify(content), selfConversationKey(identity));
  } else {
    eventContent = JSON.stringify(content);
  }

  const unsigned: UnsignedEvent = {
    kind: KIND.CREDIT,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: eventContent,
  };
  return finalizeEvent(unsigned, identity.secretKey);
}

/** True if a CREDIT event is tagged private (self-encrypted content). */
export function isPrivateCredit(event: Event): boolean {
  return event.tags.some((t) => t[0] === PRIVATE_TAG && t[1] === "true");
}

/**
 * Decrypt a private credit's content. Only succeeds if `identity` is
 * the same identity that encrypted it in the first place (i.e. you're
 * viewing your own credit) — nip44 will throw otherwise, which we
 * convert to `null` rather than letting it bubble up as a crash.
 */
export function decryptPrivateCredit(identity: Identity, event: Event): CreditContent | null {
  try {
    const plaintext = nip44.decrypt(event.content, selfConversationKey(identity));
    const parsed = JSON.parse(plaintext);
    // Re-use the same shape validation as public credits — a corrupted or
    // unexpectedly-shaped decryption result should be rejected, not shown.
    const hasRequiredStrings =
      typeof parsed?.eventName === "string" && parsed.eventName.trim().length > 0 &&
      typeof parsed?.role === "string" && parsed.role.trim().length > 0;
    const hasValidType = EVENT_TYPES.includes(parsed?.eventType);
    const hasValidYear = typeof parsed?.year === "number" && Number.isFinite(parsed.year);
    if (!hasRequiredStrings || !hasValidType || !hasValidYear) return null;
    return parsed as CreditContent;
  } catch {
    return null;
  }
}

/**
 * Build and sign a CONFIRMATION event: "I attest I worked this credit
 * alongside this person." The "d" tag makes it replaceable per
 * (confirmer, credit) pair, so un-confirming is just publishing an
 * empty-content version — see `retractConfirmation`.
 *
 * @param creditEvent The CREDIT event being confirmed (need its id + owner pubkey).
 */
export function signConfirmation(
  identity: Identity,
  creditEvent: Event,
  content: ConfirmationContent = {}
): Event {
  const dTag = `${creditEvent.pubkey}:${creditEvent.id}`;
  const unsigned: UnsignedEvent = {
    kind: KIND.CONFIRMATION,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", dTag],
      ["e", creditEvent.id], // the credit being confirmed
      ["p", creditEvent.pubkey], // the credit owner
    ],
    content: JSON.stringify(content),
  };
  return finalizeEvent(unsigned, identity.secretKey);
}

/** Retract a confirmation by publishing an empty replacement — same (confirmer, credit) "d" tag, no content. Relays that implement NIP-33 will treat this as the current state. */
export function retractConfirmation(identity: Identity, creditEvent: Event): Event {
  return signConfirmation(identity, creditEvent, {});
}

/** Is this confirmation event "active" (not retracted)? */
export function isConfirmationActive(confirmationEvent: Event): boolean {
  return confirmationEvent.content.trim().length > 0;
}

/** Build and sign an ORG_PROFILE event for an event/organization identity. */
export function signOrgProfile(identity: Identity, content: OrgProfileContent): Event {
  const unsigned: UnsignedEvent = {
    kind: KIND.ORG_PROFILE,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(content),
  };
  return finalizeEvent(unsigned, identity.secretKey);
}

/**
 * An org signs a batch of CREDENTIAL_OFFER events — one per row in
 * their staff-list upload. These sit on relays unclaimed until the
 * actual worker finds theirs (via claim code) and turns it into their
 * own signed CREDIT event. The org never signs anything on the
 * worker's behalf.
 */
export function signCredentialOffer(
  orgIdentity: Identity,
  offerId: string,
  content: CredentialOfferContent
): Event {
  const unsigned: UnsignedEvent = {
    kind: KIND.CREDENTIAL_OFFER,
    pubkey: orgIdentity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", offerId],
      ["claim_code", content.claimCode],
    ],
    content: JSON.stringify(content),
  };
  return finalizeEvent(unsigned, orgIdentity.secretKey);
}

/**
 * A worker claims an offer: they find the CREDENTIAL_OFFER event
 * matching their claim code, then sign their OWN CREDIT event that
 * copies its details and links back with `claimedFromOfferId`. This is
 * the moment the credit becomes theirs — the org's offer alone never
 * appears on anyone's profile.
 */
export function claimOffer(
  workerIdentity: Identity,
  offerEvent: Event,
  offerContent: CredentialOfferContent
): Event {
  const creditId = newCreditId();
  const content: CreditContent = {
    eventName: offerContent.eventName,
    eventType: offerContent.eventType,
    role: offerContent.role,
    year: offerContent.year,
    endYear: offerContent.endYear ?? null,
    description: offerContent.description,
    claimedFromOfferId: offerEvent.id,
  };
  return signCredit(workerIdentity, creditId, content);
}

/** Verify any event's signature is valid for the pubkey it claims. Always check this on anything fetched from a relay — relays are not trusted. */
export function isEventValid(event: Event): boolean {
  return verifyEvent(event);
}

/**
 * Safely parse an event's JSON content, returning null on malformed
 * data instead of throwing. Note this alone does NOT verify the
 * content actually has the shape you expect — see `parseCreditContent`
 * for that, and prefer it for anything from CREDIT events.
 */
export function parseContent<T>(event: Event): T | null {
  try {
    return JSON.parse(event.content) as T;
  } catch {
    return null;
  }
}

/**
 * Kind 32100 is a number we chose, not one reserved anywhere — nothing
 * stops an unrelated app (or random test traffic) from publishing its
 * own, differently-shaped events under the same kind number on the
 * same public relays. An earlier version trusted any event of this
 * kind blindly (`JSON.parse(...) as CreditContent`, a compile-time-only
 * cast with zero runtime check), so foreign events with a coincidentally
 * valid-JSON-but-wrong-shape content sailed straight into the feed as
 * garbled "credits" — e.g. showing a real (unrelated) person's real
 * Nostr display name next to "undefined" where a role and year should
 * have been snippet.
 *
 * This checks the actual shape before accepting anything as a credit.
 * Events that fail this are treated as not-ours and filtered out
 * silently, the same as if they'd failed signature verification.
 */
export function parseCreditContent(event: Event): CreditContent | null {
  const parsed = parseContent<any>(event);
  if (!parsed || typeof parsed !== "object") return null;

  const hasRequiredStrings =
    typeof parsed.eventName === "string" && parsed.eventName.trim().length > 0 &&
    typeof parsed.role === "string" && parsed.role.trim().length > 0;
  const hasValidType = EVENT_TYPES.includes(parsed.eventType);
  const hasValidYear = typeof parsed.year === "number" && Number.isFinite(parsed.year) && parsed.year > 1900 && parsed.year < 2200;

  if (!hasRequiredStrings || !hasValidType || !hasValidYear) return null;

  // endYear and description are optional but must be the right type if present
  if (parsed.endYear !== undefined && parsed.endYear !== null && typeof parsed.endYear !== "number") return null;
  if (parsed.description !== undefined && typeof parsed.description !== "string") return null;

  return parsed as CreditContent;
}
