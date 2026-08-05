/**
 * The plain-language explainer, served at /about.
 *
 * Rendered from WHAT-IT-DOES.md rather than duplicated as markup, so the page
 * and the file in the repository cannot drift apart. Two copies of the same
 * explanation is two chances to leave one of them wrong.
 *
 * The source is a file we author and commit, not user input, so the markdown is
 * rendered without sanitisation. That would need to change the moment this
 * renders anything a stranger can write.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

import { page } from "./shell.js";

/** Resolves from src/ under tsx, dist/ after a build, and /app in the container. */
const SOURCE = fileURLToPath(new URL("../../WHAT-IT-DOES.md", import.meta.url));

let cached: string | null = null;

export async function renderAbout(): Promise<string> {
  if (cached) return cached;

  let html: string;
  try {
    const markdown = await readFile(SOURCE, "utf8");
    html = await marked.parse(markdown, { gfm: true });
  } catch (err) {
    console.error("[arbiter] could not read the explainer:", err);
    // Better a short honest page than a 500 on a link people are handed.
    html = `<h1>What Arbiter does</h1>
      <p>The explainer could not be loaded. It is in the repository as
      <code>WHAT-IT-DOES.md</code>.</p>`;
  }

  cached = page({
    title: "What Arbiter actually does",
    description:
      "AI assistants are starting to spend money on people's behalf, and they cannot tell a " +
      "normal payment from a trap. Arbiter is the second opinion they buy before they act. " +
      "Explained without jargon.",
    active: "about",
    body: `<div class="wrap"><article class="prose">${html}</article></div>`,
  });

  return cached;
}
