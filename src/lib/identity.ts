/**
 * identity.ts
 * -----------------------------------------------------------------------
 * Your Laminate identity IS a keypair — there's no username/password,
 * no email verification, no central account database. Nobody can
 * suspend, delete, or impersonate you except you, because only you
 * hold the private key.
 *
 * The raw key (nsec1...) is a correct but genuinely unfriendly way to
 * ask a non-technical person to back something up — it's a long,
 * unfamiliar-looking string with no error correction and nothing to
 * anchor it in muscle memory. Instead, identities here are created and
 * restored via a 12-word recovery phrase, using NIP-06 (the standard
 * BIP39/BIP32-based derivation Nostr clients use for exactly this).
 * This is the same mental model as a crypto wallet seed phrase, and —
 * because it's a real standard, not a Laminate-specific trick — the
 * same phrase can be imported into any other NIP-06-compatible Nostr
 * client if this project ever isn't your only option.
 *
 * The raw nsec/npub still exist under the hood (Nostr events are
 * always signed with them) and are available for anyone who wants
 * them, but they're no longer what a person is asked to look at or
 * copy during normal use.
 * -----------------------------------------------------------------------
 */

import { getPublicKey, nip19 } from "nostr-tools";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";

const STORAGE_KEY = "laminate:mnemonic";

/** NIP-06: m/44'/1237'/<account>'/0/0 — the standard Nostr derivation path. Account 0 unless someone deliberately wants multiple identities from one phrase. */
const DERIVATION_PATH = "m/44'/1237'/0'/0/0";

export interface Identity {
  /** Raw 32-byte secret key, used to sign events. Never leaves the device. */
  secretKey: Uint8Array;
  /** Hex-encoded public key. This IS your Laminate profile id. */
  pubkey: string;
  /** bech32 "npub..." — the shareable, human-friendly form of your pubkey. Shown in "Advanced" contexts, not the main flow. */
  npub: string;
  /** bech32 "nsec..." — derivable from the mnemonic, kept for completeness/advanced use. Prefer showing `mnemonic` to people instead. */
  nsec: string;
  /** The 12-word recovery phrase — this is what people should actually back up. */
  mnemonic: string;
}

function deriveFromMnemonic(mnemonic: string): Identity {
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(DERIVATION_PATH);
  const secretKey = child.privateKey;
  if (!secretKey) throw new Error("Failed to derive a key from that recovery phrase.");

  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey),
    mnemonic,
  };
}

/** Create a brand new identity with a fresh 12-word recovery phrase. */
export function createIdentity(): Identity {
  const mnemonic = generateMnemonic(wordlist, 128); // 128 bits of entropy = 12 words
  return deriveFromMnemonic(mnemonic);
}

/** Restore an identity from a previously-saved recovery phrase. */
export function identityFromMnemonic(mnemonic: string): Identity {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error("That doesn't look like a valid recovery phrase — check the words and try again.");
  }
  return deriveFromMnemonic(normalized);
}

/** Advanced/interop path: restore from a raw nsec instead of a phrase (e.g. an identity created in another Nostr client that isn't NIP-06 derived). Not the primary flow — no mnemonic is available for an identity restored this way. */
export function identityFromNsec(nsec: string): Identity {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") {
    throw new Error("That doesn't look like a valid nsec key.");
  }
  const secretKey = decoded.data as Uint8Array;
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey),
    mnemonic: "", // not recoverable from a raw key — flag this to the UI if it matters
  };
}

/**
 * Local persistence — intentionally the simplest possible thing
 * (localStorage) so this scaffold runs anywhere with zero setup.
 *
 * Before shipping this for real, replace with something that doesn't
 * leave a raw secret sitting in localStorage in the clear:
 *   - IndexedDB + a passphrase-derived encryption key (Web Crypto's
 *     PBKDF2/AES-GCM), so the value at rest is encrypted; or
 *   - delegate signing to a browser extension implementing NIP-07
 *     (e.g. Alby, nos2x) so the app never touches the raw key at all —
 *     the approach most real Nostr web clients use, though it trades
 *     away some of the "just works, no install" friendliness this
 *     mnemonic approach is aiming for.
 */
export function saveIdentityLocally(identity: Identity): void {
  if (identity.mnemonic) {
    localStorage.setItem(STORAGE_KEY, identity.mnemonic);
  } else {
    // Identity was restored from a raw nsec with no mnemonic — fall back
    // to storing the nsec directly under the same key so it still persists.
    localStorage.setItem(STORAGE_KEY, identity.nsec);
  }
}

export function loadIdentityLocally(): Identity | null {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return saved.startsWith("nsec1") ? identityFromNsec(saved) : identityFromMnemonic(saved);
  } catch {
    return null;
  }
}

export function clearLocalIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}
