/**
 * Shared chrome for the public pages.
 *
 * Inlined rather than served as a stylesheet: both pages are a single request
 * with no blocking assets, which matters because the free plan cold-starts and
 * the first visitor is already waiting.
 */

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export const esc = (value: string): string => value.replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c);

const STYLE = `
:root{
  --bg:#0d1117;--surface:#161b22;--raised:#1c2330;--border:#2d3a48;
  --text:#e6edf3;--muted:#8b98a5;--faint:#6a7683;
  --accent:#56d3a0;--accent-ink:#04231a;--danger:#f85149;--warn:#d29922;
  color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.6;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:880px;margin:0 auto;padding:0 24px}
a{color:var(--accent)}
code,pre{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace}

nav{border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(13,17,23,.92);
  backdrop-filter:blur(8px);z-index:10}
nav .wrap{display:flex;align-items:center;gap:20px;padding-top:14px;padding-bottom:14px}
nav img{width:26px;height:26px;border-radius:6px}
nav .name{font-weight:700;letter-spacing:-.2px;margin-right:auto;text-decoration:none;color:var(--text)}
nav a.link{color:var(--muted);text-decoration:none;font-size:14.5px}
nav a.link:hover{color:var(--text)}

h1{font-size:clamp(32px,5.6vw,52px);line-height:1.1;letter-spacing:-1.5px;margin:0 0 20px;font-weight:700}
h2{font-size:26px;letter-spacing:-.5px;margin:0 0 10px;font-weight:700}
h3{font-size:16px;font-weight:700;margin:0 0 6px}
.lede{font-size:clamp(17px,2.3vw,21px);color:var(--muted);max-width:62ch;margin:0}
.lede strong{color:var(--text);font-weight:600}
.sub{color:var(--muted);margin:0 0 26px;max-width:64ch}
p{margin:0 0 14px}

header{padding:72px 0 52px}
section{padding:48px 0;border-top:1px solid var(--border)}

.cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:32px}
.btn{display:inline-block;padding:14px 22px;border-radius:12px;text-decoration:none;
  font-weight:700;font-size:15px;border:1px solid transparent}
.btn-primary{background:var(--accent);color:var(--accent-ink)}
.btn-ghost{border-color:var(--border);color:var(--text)}
.btn:hover{opacity:.9}

.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px}
.card p{margin:0;color:var(--muted);font-size:14.5px}
.price{color:var(--accent);font-weight:700;font-size:14px;margin-bottom:10px}

pre{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;
  overflow-x:auto;font-size:13.5px;line-height:1.7;margin:0}
.dim{color:var(--faint)}
.k{color:var(--accent)}

.facts{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.fact{background:var(--surface);border:1px solid var(--border);border-radius:999px;
  padding:7px 14px;font-size:12.5px;color:var(--muted)}
.fact b{color:var(--text);font-weight:600}

/* Live verdict rendering */
.verdict{background:var(--surface);border:1px solid var(--border);border-radius:16px;
  overflow:hidden;margin-bottom:16px}
.verdict-head{padding:18px 20px;border-bottom:1px solid var(--border)}
.verdict-head h3{margin:0 0 6px}
.verdict-head p{margin:0;color:var(--muted);font-size:14px}
.verdict-body{padding:18px 20px;display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:720px){.verdict-body{grid-template-columns:1fr 1fr}}
.verdict-req pre{background:var(--raised);font-size:12.5px}
.badge{display:inline-block;padding:5px 12px;border-radius:8px;font-weight:700;font-size:13px;
  letter-spacing:.4px}
.badge.block{background:rgba(248,81,73,.15);color:var(--danger)}
.badge.warn{background:rgba(210,153,34,.15);color:var(--warn)}
.badge.allow{background:rgba(86,211,160,.15);color:var(--accent)}
.badge.escalate{background:rgba(139,152,165,.15);color:var(--muted)}
.metrics{color:var(--faint);font-size:12.5px;margin-top:10px}
.finding{border-left:2px solid var(--border);padding:0 0 0 12px;margin-top:12px}
.finding .sev{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
.sev.critical{color:var(--danger)}
.sev.high{color:var(--warn)}
.sev.medium{color:var(--muted)}
.sev.low,.sev.info{color:var(--faint)}
.finding .t{font-weight:600;font-size:14.5px;margin:2px 0}
.finding .d{color:var(--muted);font-size:13.5px}
.quiet{color:var(--faint);font-size:14px;font-style:italic}
.livetag{color:var(--faint);font-size:12.5px;margin:0 0 20px}
.livedot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);
  margin-right:7px;vertical-align:middle}

ul.plain{margin:0;padding-left:20px;color:var(--muted)}
ul.plain li{margin-bottom:9px}
ul.plain strong{color:var(--text)}

table{width:100%;border-collapse:collapse;font-size:14.5px;margin:0 0 18px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.6px}
td code{font-size:13px;color:var(--text)}

footer{padding:40px 0 72px;border-top:1px solid var(--border);color:var(--faint);font-size:13.5px}
footer a{color:var(--muted)}
`;

export function page(options: {
  title: string;
  description: string;
  body: string;
  active?: "home" | "docs";
}): string {
  const nav = (href: string, label: string, key: "home" | "docs") =>
    `<a class="link" href="${href}"${options.active === key ? ' style="color:var(--text)"' : ""}>${label}</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<link rel="icon" href="/icon.png">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:type" content="website">
<style>${STYLE}</style>
</head>
<body>
<nav><div class="wrap">
  <img src="/icon.png" alt="">
  <a class="name" href="/">Arbiter</a>
  ${nav("/", "Overview", "home")}
  ${nav("/docs", "Docs", "docs")}
  <a class="link" href="/work/">Review work</a>
</div></nav>
${options.body}
<footer><div class="wrap">
  <p>Arbiter · paid per call over <a href="https://x402.org">x402</a> on Algorand ·
     <a href="/manifest.json">manifest</a> ·
     <a href="https://github.com/godwin105/arbiter_AI">source</a></p>
  <p>Agents requesting <code>application/json</code> at <code>/</code> get the manifest, not this page.</p>
</div></footer>
</body>
</html>`;
}
