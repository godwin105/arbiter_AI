/**
 * Tests for the page shell.
 *
 * The head is the part of these pages nobody looks at, which is exactly why it
 * breaks: a relative og:image or a missing canonical produces a page that looks
 * perfect in a browser and wrong everywhere it is shared. These assert the
 * things that are invisible until they are embarrassing.
 *
 * The renderers are pure functions of config, so none of this needs a server,
 * a facilitator or a network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { config } from "../config.js";
import { renderNotFound } from "./not-found.js";
import { esc, page } from "./shell.js";

const render = (overrides: Parameters<typeof page>[0]) => page(overrides);

const base = { title: "Title", description: "Description", body: "<p>Body</p>" };

describe("page shell", () => {
  it("escapes the characters that would break out of an attribute or element", () => {
    assert.equal(esc(`<a href="x">&</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("carries the title and description through to the head", () => {
    const html = render(base);
    assert.match(html, /<title>Title<\/title>/);
    assert.match(html, /<meta name="description" content="Description">/);
  });

  it("escapes untrusted-shaped values rather than emitting them raw", () => {
    const html = render({ ...base, title: `Quote " and <tag>` });
    assert.ok(!html.includes(`content="Quote " and <tag>"`));
    assert.match(html, /<title>Quote &quot; and &lt;tag&gt;<\/title>/);
  });

  it("makes every social URL absolute, because relative ones are dropped", () => {
    const html = render({ ...base, path: "/docs" });
    for (const property of ["og:url", "og:image", "twitter:image"]) {
      const match = html.match(new RegExp(`(?:property|name)="${property}" content="([^"]+)"`));
      assert.ok(match, `${property} is missing from the head`);
      assert.match(match[1], /^https?:\/\//, `${property} must be absolute, got ${match[1]}`);
    }
  });

  it("points the canonical link at the page's own path", () => {
    assert.match(
      render({ ...base, path: "/about" }),
      new RegExp(`<link rel="canonical" href="${config.publicUrl}/about">`),
    );
  });

  it("defaults the canonical to the root when no path is given", () => {
    assert.match(
      render(base),
      new RegExp(`<link rel="canonical" href="${config.publicUrl}/">`),
    );
  });

  it("emits structured data that actually parses", () => {
    const html = render({ ...base, path: "/docs" });
    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(match, "no JSON-LD block");
    const graph = JSON.parse(match[1]) as { "@graph": { "@type": string }[] };
    assert.deepEqual(
      graph["@graph"].map((node) => node["@type"]),
      ["Organization", "WebSite", "WebPage"],
    );
  });

  it("never lets a closing script tag terminate the JSON-LD block early", () => {
    // Descriptions are authored copy today, but the escaping is what keeps that
    // from being load-bearing.
    //
    // The property under test is containment, not absence: a script element's
    // content is raw text that only `</script` can end, so markup that stays
    // inside the block is inert. Splitting the block is what would make it run.
    const html = render({ ...base, description: "</script><img src=x onerror=alert(1)>" });

    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    assert.equal(blocks.length, 1, "the JSON-LD block was split in two");
    assert.ok(JSON.parse(blocks[0].replace(/^<script[^>]*>|<\/script>$/g, "")));

    // The same string reaches the meta tags, where it is an attribute value and
    // the quoting is the only thing holding it in.
    assert.ok(!/content="[^"]*<img/.test(html), "markup broke out of a meta attribute");
  });

  it("marks pages indexable by default and honours noindex when asked", () => {
    assert.match(render(base), /<meta name="robots" content="index,follow[^"]*">/);
    assert.match(render({ ...base, noindex: true }), /<meta name="robots" content="noindex,follow">/);
  });

  it("marks the active nav link for assistive technology", () => {
    const html = render({ ...base, active: "docs" });
    assert.match(html, /<a href="\/docs" aria-current="page">Docs<\/a>/);
  });
});

describe("not found page", () => {
  it("keeps itself out of the index", () => {
    assert.match(renderNotFound("/missing"), /<meta name="robots" content="noindex,follow">/);
  });

  it("names the path that was asked for", () => {
    assert.match(renderNotFound("/pricing"), /<code>\/pricing<\/code>/);
  });

  it("escapes a path built to inject markup", () => {
    const html = renderNotFound('/<script>alert("x")</script>');
    assert.ok(!html.includes("<script>alert"), "the injected script survived");
    assert.match(html, /&lt;script&gt;/);
  });

  it("truncates a path long enough to wreck the layout", () => {
    const html = renderNotFound(`/${"a".repeat(500)}`);
    const shown = html.match(/<code>(\/a+…?)<\/code>/);
    assert.ok(shown, "the path is not shown at all");
    assert.ok(shown[1].length <= 81, `path was not truncated: ${shown[1].length} chars`);
    assert.match(shown[1], /…$/);
  });
});
