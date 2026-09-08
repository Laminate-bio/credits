import "./style.css";
import { getTheme, applyTheme } from "./state";
import { renderNav } from "./pages/nav";
import { renderFeed } from "./pages/feed";
import { renderProfileView, renderProfileEdit } from "./pages/profile";
import { renderCreditsPage } from "./pages/credits";
import { renderAddCredit } from "./pages/addCredit";
import { renderOrganizerPage } from "./pages/organizer";
import { renderReelPage } from "./pages/reel";
import { renderWhyPage } from "./pages/why";

applyTheme(getTheme());

const app = document.getElementById("app")!;

function route(): void {
  const hash = location.hash || "#/";
  const path = hash.slice(1); // drop leading '#'
  window.scrollTo(0, 0);
  renderNav();

  if (path === "/" || path === "") {
    renderFeed(app);
  } else if (path === "/profile") {
    renderProfileView(app);
  } else if (path === "/profile/edit") {
    renderProfileEdit(app);
  } else if (path.startsWith("/profile/")) {
    renderProfileView(app, path.slice("/profile/".length));
  } else if (path === "/credits/add") {
    renderAddCredit(app);
  } else if (path === "/credits/import") {
    app.innerHTML = `<div class="loading">Loading…</div>`;
    import("./pages/resumeImport").then((mod) => mod.renderResumeImportPage(app));
  } else if (path.startsWith("/credits/")) {
    renderCreditsPage(app, path.slice("/credits/".length));
  } else if (path.startsWith("/reel/")) {
    renderReelPage(app, path.slice("/reel/".length));
  } else if (path === "/organizer") {
    renderOrganizerPage(app);
  } else if (path === "/why") {
    renderWhyPage(app);
  } else {
    renderFeed(app);
  }
}

window.addEventListener("hashchange", route);
route();
