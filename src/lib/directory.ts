/**
 * directory.ts
 * -----------------------------------------------------------------------
 * The pieces above (schema, identity, credentials, relay) are
 * deliberately low-level and protocol-focused. This file is where
 * "give me a pubkey's full resume, with live verification status"
 * lives — the thing the UI actually calls.
 * -----------------------------------------------------------------------
 */

import type { Event } from "nostr-tools";
import { KIND } from "./schema";
import type { CreditContent } from "./schema";
import { queryEvents } from "./relay";
import { isEventValid, isConfirmationActive, parseContent } from "./credentials";

export interface ResolvedCredit {
  event: Event;
  content: CreditContent;
  /** Pubkeys of everyone whose confirmation is currently active (not retracted). */
  confirmedBy: string[];
  verified: boolean; // true once confirmedBy.length >= VERIFICATION_THRESHOLD
}

export const VERIFICATION_THRESHOLD = 2;

/**
 * Fetch every CREDIT this pubkey has published, each enriched with its
 * live confirmation state. Because NIP-33 events are replaceable, we
 * only keep the newest event per "d" tag (credit id).
 */
export async function fetchResumeFor(pubkey: string): Promise<ResolvedCredit[]> {
  const creditEvents = await queryEvents({ kinds: [KIND.CREDIT], authors: [pubkey] });
  const latestByCreditId = dedupeReplaceable(creditEvents);

  const results: ResolvedCredit[] = [];
  for (const event of latestByCreditId) {
    if (!isEventValid(event)) continue; // never trust an event whose signature doesn't check out
    const content = parseContent<CreditContent>(event);
    if (!content) continue;

    const confirmedBy = await fetchActiveConfirmers(pubkey, event.id);
    results.push({
      event,
      content,
      confirmedBy,
      verified: confirmedBy.length >= VERIFICATION_THRESHOLD,
    });
  }

  // newest first, by end year if present, else year
  results.sort((a, b) => (b.content.endYear ?? b.content.year) - (a.content.endYear ?? a.content.year));
  return results;
}

/** Every pubkey currently confirming a given credit (retractions already filtered out). */
async function fetchActiveConfirmers(ownerPubkey: string, creditEventId: string): Promise<string[]> {
  const dTag = `${ownerPubkey}:${creditEventId}`;
  const confirmationEvents = await queryEvents({
    kinds: [KIND.CONFIRMATION],
    "#d": [dTag],
  } as any);
  const latest = dedupeReplaceable(confirmationEvents);
  return latest.filter((e) => isEventValid(e) && isConfirmationActive(e)).map((e) => e.pubkey);
}

/** For NIP-33 replaceable events, keep only the newest event per (pubkey, kind, d-tag). */
function dedupeReplaceable(events: Event[]): Event[] {
  const latest = new Map<string, Event>();
  for (const event of events) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const key = `${event.pubkey}:${event.kind}:${dTag}`;
    const existing = latest.get(key);
    if (!existing || event.created_at > existing.created_at) {
      latest.set(key, event);
    }
  }
  return [...latest.values()];
}

/**
 * Find a still-unclaimed CREDENTIAL_OFFER by the claim code an event
 * organizer handed the worker out-of-band (email, text, printed on
 * their badge). Used by the "claim your credit" flow.
 */
export async function fetchOfferByClaimCode(claimCode: string): Promise<Event | null> {
  const offers = await queryEvents({
    kinds: [KIND.CREDENTIAL_OFFER],
    "#claim_code": [claimCode],
  } as any);
  const valid = offers.filter(isEventValid);
  if (valid.length === 0) return null;
  // newest wins if somehow duplicated
  return valid.sort((a, b) => b.created_at - a.created_at)[0];
}
