/**
 * directory.ts
 * -----------------------------------------------------------------------
 * The pieces above (schema, identity, credentials, relay) are
 * deliberately low-level and protocol-focused. This file is where
 * "give me a pubkey's full resume, with live verification status" and
 * "show me what's happening across the whole network" live — the
 * things the UI actually calls.
 *
 * Performance note: every function here that deals with multiple
 * credits batches its follow-up queries (profile lookups, confirmation
 * lookups) into a single relay round-trip using an array filter (e.g.
 * `authors: [pubkey1, pubkey2, ...]` or `"#d": [tag1, tag2, ...]`),
 * rather than querying once per credit in a loop. An earlier version
 * did the latter — correct, but with N credits it meant roughly 2×N
 * sequential relay round-trips before the feed could render, which is
 * exactly why the feed used to feel slow and inconsistent. Keep new
 * multi-credit queries in this same batched shape.
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

/**
 * Fetch active (non-retracted) confirmations for many credits at once,
 * across possibly-different owners, in a single relay query. Returns a
 * map keyed by the same "d" tag used on CONFIRMATION events
 * (`${ownerPubkey}:${creditEventId}`) so callers can look up their own
 * events by building the same key.
 */
async function fetchConfirmationsBatch(dTags: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (dTags.length === 0) return result;

  const events = await queryEvents({ kinds: [KIND.CONFIRMATION], "#d": dTags } as any);
  const latest = dedupeReplaceable(events);
  const active = latest.filter((e) => isEventValid(e) && isConfirmationActive(e));

  for (const e of active) {
    const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    if (!result.has(dTag)) result.set(dTag, []);
    result.get(dTag)!.push(e.pubkey);
  }
  return result;
}

/**
 * Fetch profiles for many pubkeys at once, in a single relay query.
 * Returns a map keyed by pubkey; pubkeys with no published profile are
 * simply absent from the map rather than mapped to null.
 */
async function fetchProfilesBatch(pubkeys: string[]): Promise<Map<string, ProfileContent>> {
  const result = new Map<string, ProfileContent>();
  const unique = [...new Set(pubkeys)];
  if (unique.length === 0) return result;

  const events = await queryEvents({ kinds: [KIND.PROFILE], authors: unique });
  const valid = events.filter(isEventValid);

  const latestPerAuthor = new Map<string, Event>();
  for (const e of valid) {
    const existing = latestPerAuthor.get(e.pubkey);
    if (!existing || e.created_at > existing.created_at) latestPerAuthor.set(e.pubkey, e);
  }
  for (const [pubkey, e] of latestPerAuthor) {
    const content = parseContent<ProfileContent>(e);
    if (content) result.set(pubkey, content);
  }
  return result;
}

/** Fetch a single pubkey's current profile (bio, title, location, skills). Null if they haven't published one yet. For fetching several profiles at once, use the internal batch helper instead of calling this in a loop. */
export async function fetchProfile(pubkey: string): Promise<ProfileContent | null> {
  const batch = await fetchProfilesBatch([pubkey]);
  return batch.get(pubkey) ?? null;
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
  const isOwnerViewing = !!viewerIdentity && viewerIdentity.pubkey === pubkey;

  // First pass: validate signatures and decode content, without touching
  // the network again — this decides which events are even worth asking
  // relays about confirmations for.
  const decoded: { event: Event; content: CreditContent; isPrivate: boolean }[] = [];
  for (const event of latestByCreditId) {
    if (!isEventValid(event)) continue;
    const priv = isPrivateCredit(event);
    let content: CreditContent | null;
    if (priv) {
      if (!isOwnerViewing) continue;
      content = decryptPrivateCredit(viewerIdentity!, event);
    } else {
      content = parseContent<CreditContent>(event);
    }
    if (!content) continue;
    decoded.push({ event, content, isPrivate: priv });
  }

  // One batched query for every public credit's confirmations, instead
  // of one query per credit.
  const dTags = decoded.filter((d) => !d.isPrivate).map((d) => `${pubkey}:${d.event.id}`);
  const confirmationsByDTag = await fetchConfirmationsBatch(dTags);

  const results: ResolvedCredit[] = decoded.map(({ event, content, isPrivate }) => {
    const confirmedBy = isPrivate ? [] : confirmationsByDTag.get(`${pubkey}:${event.id}`) ?? [];
    return {
      event,
      content,
      isPrivate,
      confirmedBy,
      verified: confirmedBy.length >= VERIFICATION_THRESHOLD,
    };
  });

  // newest first, by end year if present, else year
  results.sort((a, b) => (b.content.endYear ?? b.content.year) - (a.content.endYear ?? a.content.year));
  return results;
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
 *
 * This does exactly 3 relay round-trips total regardless of how many
 * credits are in the feed: one for the credits themselves, one for
 * every author's profile (batched), one for every credit's
 * confirmations (batched).
 */
export async function fetchGlobalFeed(limit: number = FEED_LIMIT): Promise<FeedItem[]> {
  const events = await queryEvents({ kinds: [KIND.CREDIT], limit } as any);
  const latestByCreditId = dedupeReplaceable(events);

  const validPublic = latestByCreditId
    .filter((e) => isEventValid(e) && !isPrivateCredit(e))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit);

  const decoded = validPublic
    .map((event) => ({ event, content: parseContent<CreditContent>(event) }))
    .filter((d): d is { event: Event; content: CreditContent } => d.content !== null);

  const [profilesByPubkey, confirmationsByDTag] = await Promise.all([
    fetchProfilesBatch(decoded.map((d) => d.event.pubkey)),
    fetchConfirmationsBatch(decoded.map((d) => `${d.event.pubkey}:${d.event.id}`)),
  ]);

  return decoded.map(({ event, content }) => {
    const confirmedBy = confirmationsByDTag.get(`${event.pubkey}:${event.id}`) ?? [];
    return {
      event,
      content,
      authorPubkey: event.pubkey,
      authorName: profilesByPubkey.get(event.pubkey)?.name ?? null,
      confirmedBy,
      verified: confirmedBy.length >= VERIFICATION_THRESHOLD,
    };
  });
}
