import { state, getTheme, applyTheme } from "../state";
import { escapeHtml } from "../util";

export function renderNav(): void {
  const nav = document.getElementById("headerNav")!;
  const theme = getTheme();

  nav.innerHTML = `
    <a href="#/" class="nav-link" data-route="/">Feed</a>
    <a href="#/profile" class="nav-link" data-route="/profile">My profile</a>
    <a href="#/credits/add" class="nav-link" data-route="/credits/add">Add a credit</a>
    <a href="#/organizer" class="nav-link" data-route="/organizer">For organizers</a>
    ${state.me ? `<span class="identity-chip">${state.myDisplayName ? escapeHtml(state.myDisplayName) : "Signed in"}</span>` : ""}
    <button class="theme-toggle" id="themeToggle">${theme === "dark" ? "☀ Light" : "● Dark"}</button>
  `;

  document.getElementById("themeToggle")!.addEventListener("click", () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    renderNav();
  });

  highlightActiveRoute();
}

function highlightActiveRoute(): void {
  const hash = location.hash || "#/";
  document.querySelectorAll<HTMLAnchorElement>(".nav-link").forEach((link) => {
    const route = link.dataset.route!;
    const isActive = route === "/" ? hash === "#/" || hash === "" : hash.startsWith(`#${route}`);
    link.classList.toggle("active", isActive);
  });
}

window.addEventListener("hashchange", highlightActiveRoute);
