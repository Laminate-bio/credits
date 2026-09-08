/**
 * schema.ts
 * -----------------------------------------------------------------------
 * The data model for Laminate, expressed as Nostr event kinds.
 *
 * Nothing here is a database row. Everything is a signed event that
 * anyone can independently verify against the signer's public key.
 * The "database" is just relays (dumb pass-through servers) plus each
 * person's own local cache of events they care about.
 *
 * Kind numbers in the 30000–39999 range are "parameterized replaceable"
 * events (NIP-33): a later event with the same (pubkey, kind, d-tag)
 * replaces the earlier one. That's what lets you *edit* a credit or
 * *retract* a confirmation without a central database doing an UPDATE.
 *
 * These kind numbers are provisional. Before this goes further, write
 * them up as a proper NIP (Nostr Implementation Possibility) doc in
 * /docs so other clients can interoperate — see README.md.
 * -----------------------------------------------------------------------
 */

export const KIND = {
  /** Standard Nostr profile metadata (NIP-01). name, about, picture. */
  PROFILE: 0,

  /** A single production credit, owned and signed by the crew member. */
  CREDIT: 32100,

  /** A peer's signed confirmation that they worked a credit alongside someone. */
  CONFIRMATION: 32101,

  /**
   * An event/organization's public identity record.
   * Distinct from a person's PROFILE so the UI can tell people and
   * organizations apart, and so orgs can be verified separately later
   * (e.g. by proving control of the event's domain, NIP-05 style).
   */
  ORG_PROFILE: 32200,

  /**
   * An unsigned credential OFFER issued by an event/org to a specific
   * crew member, as part of a bulk staff-list upload. This is NOT a
   * credit yet — it only becomes one when the recipient claims it by
   * publishing their own signed CREDIT event that references this offer.
   * This is the mechanic that keeps "events can bulk-issue credit" from
   * turning into "events can silently edit your resume."
   */
  CREDENTIAL_OFFER: 32300
} as const;

/** The three event categories from the original brief. Extend freely. */
export type EventType =
  | "Music Festival"
  | "Conference"
  | "Sporting Event"
  | "Corporate Event"
  | "Theater / Live Show"
  | "Other";

/** The JSON payload stored in a CREDIT event's `content` field. */
export interface CreditContent {
  eventName: string;
  eventType: EventType;
  role: string;
  year: number;
  endYear?: number | null;
  description?: string;
  /**
   * If this credit originated from a claimed CREDENTIAL_OFFER, the event
   * id of that offer. Lets a viewer trace the credit back to the
   * organization that issued it, in addition to any peer confirmations.
   */
  claimedFromOfferId?: string;
}

/** The JSON payload stored in a CONFIRMATION event's `content` field. */
export interface ConfirmationContent {
  /** Optional free-text note, e.g. "Ran monitors next to them all weekend." */
  note?: string;
}

/** The JSON payload for an ORG_PROFILE event. */
export interface OrgProfileContent {
  name: string;
  website?: string;
  about?: string;
}

/**
 * The JSON payload stored in a standard kind-0 PROFILE event's `content`.
 * `name` and `about` are the standard NIP-01 fields recognized by any
 * Nostr client; `title`, `location`, and `skills` are Laminate-specific
 * extensions — harmless extra JSON keys that other clients will just
 * ignore, but that our own UI reads back out.
 */
export interface ProfileContent {
  name: string;
  about?: string; // bio
  title?: string; // e.g. "FOH Audio Engineer"
  location?: string;
  skills?: string[];
}

/** Tag name marking a CREDIT event's content as nip44-self-encrypted. Presence of this tag (value "true") means `content` is ciphertext, not plain JSON — see credentials.ts. */
export const PRIVATE_TAG = "private";

/** The JSON payload for a CREDENTIAL_OFFER event, before it's claimed. */
export interface CredentialOfferContent {
  /** Free-text identifier the org used to name this person (email, badge name, etc). Not a pubkey — the org may not know the worker's pubkey yet. */
  recipientLabel: string;
  eventName: string;
  eventType: EventType;
  role: string;
  year: number;
  endYear?: number | null;
  description?: string;
  /** One-time claim code the org distributes to the actual worker out-of-band (email, text, printed badge). */
  claimCode: string;
  /** Whether this offer has already been claimed — set by the org after seeing a claim. Advisory only; the real source of truth is whether a CREDIT event references this offer id. */
  claimed?: boolean;
}
