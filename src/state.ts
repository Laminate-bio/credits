import type { Identity } from "./lib/identity";
import { identityFromNsec, loadIdentityLocally } from "./lib/identity";

export const state: { me: Identity | null; org: Identity | null; myDisplayName: string | null } = {
  me: loadIdentityLocally(),
  org: null,
  myDisplayName: null,
};

const ORG_STORAGE_KEY = "laminate:nsec:org-demo";

try {
  const raw = localStorage.getItem(ORG_STORAGE_KEY);
  if (raw) state.org = identityFromNsec(raw);
} catch {
  state.org = null;
}

export function saveOrgIdentity(identity: Identity): void {
  state.org = identity;
  localStorage.setItem(ORG_STORAGE_KEY, identity.nsec);
}

export const THEME_KEY = "laminate:theme";

export function getTheme(): "light" | "dark" {
  return (localStorage.getItem(THEME_KEY) as "light" | "dark") || "light";
}

export function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}
