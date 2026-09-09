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
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nostr.wine",
];

/**
 * How long a query waits for relays to finish responding before giving
 * up and returning whatever it has. Affordable to be generous here
 * now that queries are batched (a handful of round-trips per page,
 * not one per credit) — a slightly slower complete result beats a
 * fast incomplete one that makes the feed look like it's missing posts.
 */
const QUERY_MAX_WAIT_MS = 5000;

const pool = new SimplePool();

export async function publishEvent(event: Event, relays: string[] = DEFAULT_RELAYS): Promise<void> {
  await Promise.any(pool.publish(relays, event));
}

/** One-shot query: fetch whatever matches `filter` from the given relays right now. */
export async function queryEvents(filter: Filter, relays: string[] = DEFAULT_RELAYS): Promise<Event[]> {
  return pool.querySync(relays, filter, { maxWait: QUERY_MAX_WAIT_MS });
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
