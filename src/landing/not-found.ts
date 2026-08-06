/**
 * The 404 page.
 *
 * Only browsers see it. Agents and anything else asking for JSON keep getting
 * `{"error":"not_found"}` from the server's terminal handler, because a client
 * parsing a verdict must never be handed markup — the whole point of the
 * content negotiation at `/` applies just as much to the failure case.
 *
 * It carries the same chrome as every other page so a person who mistyped a URL
 * lands somewhere that is recognisably still the service, with the three real
 * destinations in front of them rather than a dead end.
 */
import { esc, page } from "./shell.js";

export function renderNotFound(path: string): string {
  return page({
    title: "Not found — Arbiter",
    description: "That page does not exist. The endpoints and documentation are at /docs.",
    // A 404 is not a destination, and indexing one splits the site's ranking
    // across URLs that were never meant to exist.
    noindex: true,
    body: `
<div class="wrap">
  <header>
    <p class="eyebrow"><b>404</b> no such page</p>
    <h1>That page isn't here.</h1>
    <p class="lede">
      Nothing is served at <code>${escapePath(path)}</code>. It may have moved, or the link
      that brought you here may be wrong.
    </p>
    <div class="cta">
      <a class="btn btn-primary" href="/">Back to the overview</a>
      <a class="btn btn-ghost" href="/docs">Read the docs</a>
    </div>
    <div class="facts">
      <span class="fact">Endpoints and pricing <b>/docs</b></span>
      <span class="fact">Plain-language explainer <b>/about</b></span>
      <span class="fact">Machine-readable <b>/manifest.json</b></span>
    </div>
  </header>
</div>`,
  });
}

/**
 * The requested path is attacker-controlled and is echoed back into the page,
 * so it is escaped and capped rather than trusted. Length matters as much as
 * the characters: a multi-kilobyte URL would otherwise blow out the layout.
 */
function escapePath(path: string): string {
  return esc(path.length > 80 ? `${path.slice(0, 80)}…` : path);
}
