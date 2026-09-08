/**
 * directory.ts
 * -----------------------------------------------------------------------
 * The pieces above (schema, identity, credentials, relay) are
 * deliberately low-level and protocol-focused. This file is where
 * "give me a pubkey's full resume, with live verification status" and
 * "show me what's happening across the whole network" live — the
 * things the UI actually calls.
 * -----------------------------------------------------------------------
 */

import type { Event } from "nostr-tools";
import { KIND } from "./schema";
import type { CreditContent, ProfileContent } from "./schema";
import { queryEvents } from "./relay";
import {
  isEventValid,
  isConfirmationActive,
  isPrivateCredit,
  decryptPrivateCredit,
  parseContent,
} from "./credentials";
import type { Identity } from "./identity";

export interface ResolvedCredit {
  event: Event;
  content: CreditContent;
  isPrivate: boolean;
  /** Pubkeys of everyone whose confirmation is currently active (not retracted). Always empty for private credits — nobody else can read them to confirm. */
  confirmedBy: string[];
  verified: boolean; // true once confirmedBy.length >= VERIFICATION_THRESHOLD
}

export const VERIFICATION_THRESHOLD = 2;
export const FEED_LIMIT = 60;

/** For NIP-01/NIP-33 replaceable events, keep only the newest event per (pubkey, kind, d-tag). Kind-0 profiles have no "d" tag, which is fine — they naturally key on pubkey+kind alone. */
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

/** Fetch a pubkey's current profile (bio, title, location, skills). Null if they haven't published one yet. */
export async function fetchProfile(pubkey: string): Promise<ProfileContent | null> {
  const events = await queryEvents({ kinds: [KIND.PROFILE], authors: [pubkey] });
  const valid = events.filter(isEventValid);
  if (valid.length === 0) return null;
  const latest = valid.sort((a, b) => b.created_at - a.created_at)[0];
  return parseContent<ProfileContent>(latest);
}

/**
 * Fetch every CREDIT this pubkey has published, each enriched with its
 * live confirmation state.
 *
 * Pass `viewerIdentity` when the person looking is (possibly) the
 * owner — private credits only decrypt successfully when the viewer
 * holds the same private key that encrypted them. Looking at someone
 * else's profile, private credits simply don't appear (their content
 * is unreadable ciphertext, so they're filtered out rather than shown
 * as a locked placeholder — this profile doesn't reveal how many
 * private credits someone has).
 */
export async function fetchResumeFor(
  pubkey: string,
  viewerIdentity?: Identity | null
): Promise<ResolvedCredit[]> {
  const creditEvents = await queryEvents({ kinds: [KIND.CREDIT], authors: [pubkey] });
  const latestByCreditId = dedupeReplaceable(creditEvents);

  const results: ResolvedCredit[] = [];
  for (const event of latestByCreditId) {
    if (!isEventValid(event)) continue; // never trust an event whose signature doesn't check out
    const isOwnerViewing = !!viewerIdentity && viewerIdentity.pubkey === pubkey;
    const priv = isPrivateCredit(event);

    let content: CreditContent | null;
    if (priv) {
      if (!isOwnerViewing) continue; // can't read it, can't show it
      content = decryptPrivateCredit(viewerIdentity!, event);
    } else {
      content = parseContent<CreditContent>(event);
    }
    if (!content) continue;

    const confirmedBy = priv ? [] : await fetchActiveConfirmers(pubkey, event.id);
    results.push({
      event,
      content,
      isPrivate: priv,
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
  return valid.sort((a, b) => b.created_at - a.created_at)[0];
}

/** A friendly display name for a pubkey — their published profile name if they have one, or a clearly-labeled placeholder (never a raw hex string) if not. */
export async function fetchDisplayName(pubkey: string): Promise<string> {
  const profile = await fetchProfile(pubkey);
  return profile?.name || "Unnamed crew member";
}

export interface FeedItem {
  event: Event;
  content: CreditContent;
  authorPubkey: string;
  authorName: string | null;
  confirmedBy: string[];
  verified: boolean;
}

/**
 * The global public feed: recent public credits from anyone, newest
 * post first. Private credits are structurally excluded — their
 * content is ciphertext, so it fails JSON parsing and gets filtered
 * out even without checking the privacy tag, as defense in depth.
 */
export async function fetchGlobalFeed(limit: number = FEED_LIMIT): Promise<FeedItem[]> {
  const events = await queryEvents({ kinds: [KIND.CREDIT], limit } as any);
  const latestByCreditId = dedupeReplaceable(events);

  const validPublic = latestByCreditId
    .filter((e) => isEventValid(e) && !isPrivateCredit(e))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);

  const profileCache = new Map<string, string | null>();
  const items: FeedItem[] = [];

  for (const event of validPublic) {
    const content = parseContent<CreditContent>(event);
    if (!content) continue;

    if (!profileCache.has(event.pubkey)) {
      const profile = await fetchProfile(event.pubkey);
      profileCache.set(event.pubkey, profile?.name ?? null);
    }
    const confirmedBy = await fetchActiveConfirmers(event.pubkey, event.id);

    items.push({
      event,
      content,
      authorPubkey: event.pubkey,
      authorName: profileCache.get(event.pubkey) ?? null,
      confirmedBy,
      verified: confirmedBy.length >= VERIFICATION_THRESHOLD,
    });
  }

  return items;
}
