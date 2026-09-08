/**
 * credentials.ts
 * -----------------------------------------------------------------------
 * Turns the schema types into actual signed Nostr events, and back.
 * This is the layer that makes trust cryptographic instead of
 * "whoever has write access to the database wins."
 * -----------------------------------------------------------------------
 */

import { finalizeEvent, verifyEvent, type Event, type UnsignedEvent } from "nostr-tools";
import { KIND } from "./schema";
import type {
  CreditContent,
  ConfirmationContent,
  OrgProfileContent,
  CredentialOfferContent,
} from "./schema";
import type { Identity } from "./identity";

/** Every credit needs a stable id so it can be edited (replaced) or referenced by confirmations. Call this once when a credit is first created, then keep reusing it. */
export function newCreditId(): string {
  return crypto.randomUUID();
}

/**
 * Build and sign a CREDIT event.
 * Re-signing with the same `creditId` (used as the NIP-33 "d" tag)
 * replaces the previous version on relays that honor NIP-33 — this is
 * how "editing a credit" works without a central UPDATE statement.
 */
export function signCredit(
  identity: Identity,
  creditId: string,
  content: CreditContent
): Event {
  const unsigned: UnsignedEvent = {
    kind: KIND.CREDIT,
    pubkey: identity.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", creditId]],
    content: JSON.stringify(content),
  };
  return finalizeEvent(unsigned, identity.secretKey);
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

/** Safely parse an event's JSON content, returning null on malformed data instead of throwing (relay data should never be trusted blindly). */
export function parseContent<T>(event: Event): T | null {
  try {
    return JSON.parse(event.content) as T;
  } catch {
    return null;
  }
}
