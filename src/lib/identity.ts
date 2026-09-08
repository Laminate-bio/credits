/**
 * identity.ts
 * -----------------------------------------------------------------------
 * Your Laminate identity IS a keypair. There is no username/password,
 * no email verification, no central account database. This is the whole
 * point — nobody can suspend, delete, or impersonate your identity
 * except you, because only you hold the private key.
 *
 * The real cost of this model: if you lose your private key, you lose
 * the identity. There's no "forgot password" email to click. This file
 * stores the key in the browser via nsec (bech32-encoded private key)
 * so it's copyable as a single line of text — treat that line the way
 * you'd treat a crypto wallet seed phrase. A production build should:
 *   1. Show the nsec once at signup with a clear "save this somewhere
 *      safe" warning, the same way wallets show a 12-word phrase.
 *   2. Consider a social-recovery scheme (e.g. threshold signatures
 *      held by trusted peers) as a friendlier alternative for
 *      non-technical users. That's a real design project on its own —
 *      not stubbed out here.
 * -----------------------------------------------------------------------
 */

import {
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";

const STORAGE_KEY = "laminate:nsec";

export interface Identity {
  /** Raw 32-byte secret key, used to sign events. Never leaves the device. */
  secretKey: Uint8Array;
  /** Hex-encoded public key. This IS your Laminate profile id. */
  pubkey: string;
  /** bech32 "npub..." — the shareable, human-friendly form of your pubkey. */
  npub: string;
  /** bech32 "nsec..." — the shareable, human-friendly form of your secret key. Guard this like a password. */
  nsec: string;
}

function toIdentity(secretKey: Uint8Array): Identity {
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey),
  };
}

/** Create a brand new identity. Caller is responsible for showing the nsec to the user for backup before it's needed again. */
export function createIdentity(): Identity {
  const secretKey = generateSecretKey();
  return toIdentity(secretKey);
}

/** Restore an identity from a previously-saved nsec (e.g. the user pasting their backup back in on a new device). */
export function identityFromNsec(nsec: string): Identity {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error("That doesn't look like a valid nsec key.");
  }
  return toIdentity(decoded.data as Uint8Array);
}

/**
 * Local persistence — intentionally the simplest possible thing
 * (localStorage) so this scaffold runs anywhere with zero setup.
 *
 * Before shipping this for real, replace with something that doesn't
 * leave a raw secret key sitting in localStorage in the clear:
 *   - IndexedDB + a passphrase-derived encryption key (Web Crypto's
 *     PBKDF2/AES-GCM), so the key at rest is encrypted; or
 *   - delegate signing to a browser extension implementing NIP-07
 *     (e.g. Alby, nos2x) so the app never touches the raw key at all —
 *     this is the approach most real Nostr web clients use.
 */
export function saveIdentityLocally(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, identity.nsec);
}

export function loadIdentityLocally(): Identity | null {
  const nsec = localStorage.getItem(STORAGE_KEY);
  if (!nsec) return null;
  try {
    return identityFromNsec(nsec);
  } catch {
    return null;
  }
}

export function clearLocalIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}
