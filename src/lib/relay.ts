/**
 * relay.ts
 * -----------------------------------------------------------------------
 * Relays are dumb, replaceable pass-through servers — not a database
 * you trust, just a place events get delivered through. We publish to
 * several at once for redundancy, and query several at once so no
 * single relay operator can hide or censor data.
 *
 * Anyone can run a relay (many open-source options exist, e.g.
 * strfry, nostr-rs-relay). Consider running one for the Laminate
 * community specifically once this has real users, alongside the
 * public defaults below, so it doesn't fully depend on the general
 * Nostr relay ecosystem's uptime.
 * -----------------------------------------------------------------------
 */

import { SimplePool, type Event, type Filter } from "nostr-tools";

/**
 * Public, free, widely-used relays as a starting default. Swap or
 * extend this list — ideally make it user-configurable in Settings,
 * since relay choice is part of what keeps this decentralized (no
 * single relay operator should be a single point of failure or control).
 */
/**
 * Public, free, widely-used relays as a starting default. Swap or
 * extend this list — ideally make it user-configurable in Settings,
 * since relay choice is part of what keeps this decentralized (no
 * single relay operator should be a single point of failure or control).
 *
 * Five relays, not three — with only a couple of relays, one being slow
 * or briefly down measurably affects whether a query comes back
 * complete. More relays queried in parallel costs little extra time
 * (they're not sequential) but meaningfully improves the odds of a
 * complete result.
 */
/**
 * Public, free, widely-used relays as a starting default.
 *
 * Deliberately just two, and specifically these two: relay.damus.io and
 * nos.lol are among the most consistently fast, reliable public relays
 * in the whole Nostr ecosystem. This used to be five, on the theory
 * that more relays meant better redundancy — but querySync waits for
 * EVERY relay it queries to either respond or time out before it
 * resolves anything, not just the fastest one. Adding relays without
 * verifying they're actually fast from wherever your users are made
 * every query slower, gated on whichever relay was worst that day.
 * With realistically few users right now, speed matters far more than
 * redundancy — revisit this trade-off once there's an actual reason to
 * (censorship resistance, an outage of one of these two).
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
];

/**
 * How long a query waits for relays to finish responding before giving
 * up and returning whatever it has. Kept short and deliberately erring
 * toward "fast but maybe incomplete" over "complete but slow" — with
 * few users and few events right now, there's rarely enough data
 * sitting on a slow relay to be worth waiting on.
 */
const QUERY_MAX_WAIT_MS = 2500;

const pool = new SimplePool();

/**
 * Short-lived in-memory cache so navigating around the site during a
 * session doesn't re-run an identical relay query every single click —
 * e.g. clicking Feed → Profile → Feed again within a few seconds reuses
 * the first Feed query's result instead of hitting relays again.
 * Intentionally short (not persisted, not shared across tabs) so it
 * never meaningfully delays seeing a new credit someone actually just
 * published — this is about avoiding redundant re-fetches, not being a
 * real data layer.
 */
const CACHE_TTL_MS = 15_000;
const queryCache = new Map<string, { events: Event[]; expiresAt: number }>();

function cacheKey(filter: Filter, relays: string[]): string {
  return JSON.stringify({ filter, relays });
}

export async function publishEvent(event: Event, relays: string[] = DEFAULT_RELAYS): Promise<void> {
  await Promise.any(pool.publish(relays, event));
  queryCache.clear(); // whatever we just published should be visible immediately, not masked by a stale cache entry
}

/** One-shot query: fetch whatever matches `filter` from the given relays right now. Cached briefly — pass `forceFresh` (e.g. from an explicit Refresh button) to bypass the cache. */
export async function queryEvents(filter: Filter, relays: string[] = DEFAULT_RELAYS, forceFresh = false): Promise<Event[]> {
  const key = cacheKey(filter, relays);
  const cached = queryCache.get(key);
  if (!forceFresh && cached && cached.expiresAt > Date.now()) {
    return cached.events;
  }
  const events = await pool.querySync(relays, filter, { maxWait: QUERY_MAX_WAIT_MS });
  queryCache.set(key, { events, expiresAt: Date.now() + CACHE_TTL_MS });
  return events;
}

/** Live subscription: `onEvent` fires for every matching event, including new ones as they arrive. Returns an unsubscribe function. */
export function subscribeEvents(
  filter: Filter,
  onEvent: (event: Event) => void,
  relays: string[] = DEFAULT_RELAYS
): () => void {
  const sub = pool.subscribeMany(relays, filter, {
    onevent: onEvent,
  });
  return () => sub.close();
}

export function closePool(): void {
  pool.close(DEFAULT_RELAYS);
}
