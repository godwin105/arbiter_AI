/**
 * Shared chrome for the public pages.
 *
 * Inlined rather than served as a stylesheet: both pages are a single request
 * with no blocking assets, which matters because the free plan cold-starts and
 * the first visitor is already waiting.
 *
 * The look is an instrument panel — hairline grid, mono eyebrows, meters and
 * terminal-framed code. That is not decoration for its own sake: this service
 * sells verdicts to machines, and a page that reads like a readout is honest
 * about what it is. Everything degrades to plain legible HTML with JavaScript
 * off, and every motion is behind prefers-reduced-motion.
 */
import { config } from "../config.js";

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export const esc = (value: string): string => value.replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c);

const STYLE = `
:root{
  --bg:#06090d;--bg-2:#080c11;
  --surface:#0d141b;--surface-2:#111a23;--raised:#16212c;
  --line:#1b2732;--line-2:#27384a;
  --text:#e8eff5;--muted:#94a6b5;--faint:#61768a;
  --mint:#56d3a0;--mint-dim:#2f8f6c;--mint-ink:#04231a;
  --cyan:#5ad0e6;--amber:#e3ad45;--red:#ff6259;
  --r-xs:6px;--r-sm:10px;--r-md:14px;--r-lg:20px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --ease:cubic-bezier(.22,.68,.3,1);
  color-scheme:dark;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:88px}
body{margin:0;background:var(--bg);color:var(--text);line-height:1.62;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--mint);text-underline-offset:3px}
code,pre,.mono{font-family:var(--mono)}
img{max-width:100%}
:focus-visible{outline:2px solid var(--mint);outline-offset:3px;border-radius:4px}

/* --- The field behind everything -------------------------------------- */
.backdrop{position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:
    radial-gradient(680px 420px at 12% -8%,rgba(86,211,160,.13),transparent 70%),
    radial-gradient(620px 380px at 92% 4%,rgba(90,208,230,.08),transparent 72%),
    linear-gradient(180deg,var(--bg-2),var(--bg) 42%)}
.backdrop::before{content:"";position:absolute;inset:0;opacity:.4;
  background-image:linear-gradient(rgba(120,160,190,.055) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(120,160,190,.055) 1px,transparent 1px);
  background-size:52px 52px;
  -webkit-mask-image:radial-gradient(circle at 50% 0%,#000,transparent 78%);
          mask-image:radial-gradient(circle at 50% 0%,#000,transparent 78%)}

.wrap{max-width:1060px;margin:0 auto;padding:0 clamp(18px,4vw,32px)}

/* --- Navigation --------------------------------------------------------- */
.skip{position:absolute;left:-9999px;top:8px;background:var(--mint);color:var(--mint-ink);
  padding:10px 16px;border-radius:var(--r-sm);font-weight:700;z-index:50}
.skip:focus{left:16px}

nav{position:sticky;top:0;z-index:40;border-bottom:1px solid var(--line);
  background:rgba(6,9,13,.78);backdrop-filter:blur(14px) saturate(140%)}
nav .wrap{display:flex;align-items:center;gap:14px;min-height:62px}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);
  font-weight:700;letter-spacing:-.3px;margin-right:auto}
.brand img{width:24px;height:24px;border-radius:6px;
  box-shadow:0 0 0 1px var(--line-2),0 0 22px -8px var(--mint)}
.netchip{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--mint);border:1px solid rgba(86,211,160,.32);border-radius:999px;padding:3px 9px;
  background:rgba(86,211,160,.07)}
.nav-links{display:flex;align-items:center;gap:6px}
.nav-links a{color:var(--muted);text-decoration:none;font-size:14px;padding:8px 12px;
  border-radius:var(--r-sm);transition:color .18s var(--ease),background .18s var(--ease)}
.nav-links a:hover{color:var(--text);background:rgba(255,255,255,.045)}
.nav-links a[aria-current]{color:var(--text)}
.nav-links a[aria-current]::after{content:"";display:block;height:2px;margin-top:5px;border-radius:2px;
  background:linear-gradient(90deg,var(--mint),transparent)}
.nav-links .sep{width:1px;height:20px;background:var(--line);margin:0 4px}
.nav-links a.go{color:var(--mint)}
.nav-toggle{display:none;background:transparent;border:1px solid var(--line-2);color:var(--text);
  border-radius:var(--r-sm);padding:8px 11px;cursor:pointer;font-family:var(--mono);font-size:12px}
@media(max-width:860px){
  .nav-toggle{display:block}
  .nav-links{position:absolute;top:100%;left:0;right:0;flex-direction:column;align-items:stretch;
    gap:2px;padding:10px clamp(18px,4vw,32px) 18px;background:rgba(8,12,17,.98);
    border-bottom:1px solid var(--line);display:none}
  .nav-links.open{display:flex}
  .nav-links a{padding:12px 8px;font-size:15px}
  .nav-links a[aria-current]::after{display:none}
  .nav-links .sep{display:none}
}

/* --- Type --------------------------------------------------------------- */
h1{font-size:clamp(34px,6vw,60px);line-height:1.04;letter-spacing:-1.8px;margin:0 0 22px;font-weight:750}
h2{font-size:clamp(23px,3.2vw,30px);letter-spacing:-.7px;margin:0 0 12px;font-weight:700}
h3{font-size:16.5px;font-weight:700;margin:0 0 6px;letter-spacing:-.2px}
p{margin:0 0 14px}
.lede{font-size:clamp(16.5px,2.1vw,20px);color:var(--muted);max-width:60ch;margin:0}
.lede strong{color:var(--text);font-weight:600}
.sub{color:var(--muted);margin:0 0 26px;max-width:66ch}
.eyebrow{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-size:11px;
  letter-spacing:.2em;text-transform:uppercase;color:var(--faint);margin:0 0 14px}
.eyebrow b{color:var(--mint);font-weight:600}
.eyebrow::after{content:"";flex:1;height:1px;
  background:linear-gradient(90deg,var(--line-2),transparent)}

header{padding:clamp(56px,10vw,96px) 0 clamp(40px,6vw,64px)}
section{padding:clamp(44px,7vw,72px) 0;border-top:1px solid var(--line)}

/* --- Buttons ------------------------------------------------------------ */
.cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:34px}
.btn{display:inline-flex;align-items:center;gap:9px;padding:13px 22px;border-radius:var(--r-md);
  text-decoration:none;font-weight:700;font-size:15px;border:1px solid transparent;cursor:pointer;
  font-family:inherit;transition:transform .18s var(--ease),box-shadow .18s var(--ease),
    background .18s var(--ease),border-color .18s var(--ease)}
.btn::before{content:"\\25B8";font-size:11px;opacity:.75}
.btn-primary{background:linear-gradient(180deg,#63e0ab,var(--mint));color:var(--mint-ink);
  box-shadow:0 1px 0 rgba(255,255,255,.28) inset,0 10px 30px -14px rgba(86,211,160,.9)}
.btn-primary:hover{transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.3) inset,
  0 16px 34px -14px rgba(86,211,160,1)}
.btn-ghost{border-color:var(--line-2);color:var(--text);background:rgba(255,255,255,.02)}
.btn-ghost:hover{border-color:var(--mint-dim);background:rgba(86,211,160,.07);transform:translateY(-2px)}
.btn:active{transform:translateY(0)}

/* --- Fact strip --------------------------------------------------------- */
.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.fact{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.025);
  border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--muted)}
.fact::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--mint-dim)}
.fact b{color:var(--text);font-weight:600}

/* --- Cards -------------------------------------------------------------- */
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(248px,1fr))}
.card{position:relative;background:linear-gradient(180deg,var(--surface-2),var(--surface));
  border:1px solid var(--line);border-radius:var(--r-lg);padding:22px;overflow:hidden;
  transition:transform .22s var(--ease),border-color .22s var(--ease),box-shadow .22s var(--ease)}
.card::before{content:"";position:absolute;top:0;left:18px;right:18px;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)}
.card:hover{transform:translateY(-3px);border-color:var(--mint-dim);
  box-shadow:0 18px 40px -28px rgba(0,0,0,.9),0 0 0 1px rgba(86,211,160,.12)}
.card p{margin:0;color:var(--muted);font-size:14.5px}
.card .price{display:inline-block;font-family:var(--mono);color:var(--mint);font-weight:700;
  font-size:13px;margin-bottom:12px;padding:3px 9px;border-radius:var(--r-xs);
  background:rgba(86,211,160,.09);border:1px solid rgba(86,211,160,.22)}
.card .route{font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:14px;
  padding-top:12px;border-top:1px dashed var(--line)}

/* --- Terminal-framed code ---------------------------------------------- */
.term{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  overflow:hidden;margin:0}
.term-bar{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--line);
  background:rgba(255,255,255,.022)}
.term-bar .dots{display:flex;gap:5px}
.term-bar .dots i{width:8px;height:8px;border-radius:50%;background:var(--line-2)}
.term-bar .name{font-family:var(--mono);font-size:11.5px;color:var(--faint);letter-spacing:.06em}
.copy{margin-left:auto;background:transparent;border:1px solid var(--line-2);color:var(--muted);
  border-radius:var(--r-xs);padding:4px 10px;font-family:var(--mono);font-size:11px;cursor:pointer;
  transition:color .16s var(--ease),border-color .16s var(--ease)}
.copy:hover{color:var(--text);border-color:var(--mint-dim)}
.copy[data-done]{color:var(--mint);border-color:var(--mint-dim)}
pre{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  padding:18px 20px;overflow-x:auto;font-size:13.5px;line-height:1.72;margin:0;
  -webkit-overflow-scrolling:touch}
.term pre{border:none;border-radius:0;background:transparent}
.dim{color:var(--faint)}
.k{color:var(--mint)}
.cursor{display:inline-block;width:8px;height:15px;background:var(--mint);vertical-align:-2px;
  animation:blink 1.15s steps(2,start) infinite}
@keyframes blink{50%{opacity:0}}

/* --- Live verdicts ------------------------------------------------------ */
.livetag{display:flex;align-items:center;gap:9px;color:var(--faint);font-family:var(--mono);
  font-size:12px;margin:0 0 20px;letter-spacing:.06em}
.livedot{position:relative;width:7px;height:7px;border-radius:50%;background:var(--mint);flex:none}
.livedot::after{content:"";position:absolute;inset:-4px;border-radius:50%;
  border:1px solid var(--mint);opacity:.5;animation:ping 2.2s var(--ease) infinite}
@keyframes ping{0%{transform:scale(.6);opacity:.7}100%{transform:scale(1.7);opacity:0}}

.verdict{background:linear-gradient(180deg,var(--surface-2),var(--surface));
  border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;margin-bottom:14px;
  transition:border-color .22s var(--ease)}
.verdict:hover{border-color:var(--line-2)}
.verdict-head{display:flex;align-items:flex-start;gap:14px;padding:18px 20px;
  border-bottom:1px solid var(--line)}
.verdict-head h3{margin:0 0 5px}
.verdict-head p{margin:0;color:var(--muted);font-size:14px}
.verdict-body{padding:18px 20px;display:grid;gap:20px;grid-template-columns:1fr;align-items:start}
@media(min-width:760px){.verdict-body{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.verdict-req pre{background:#070b0f;font-size:12.5px;padding:14px 16px}

.badge{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;
  font-family:var(--mono);font-weight:700;font-size:12px;letter-spacing:.12em}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;
  box-shadow:0 0 10px currentColor}
.badge.block{background:rgba(255,98,89,.12);color:var(--red);border:1px solid rgba(255,98,89,.3)}
.badge.warn{background:rgba(227,173,69,.12);color:var(--amber);border:1px solid rgba(227,173,69,.3)}
.badge.allow{background:rgba(86,211,160,.12);color:var(--mint);border:1px solid rgba(86,211,160,.3)}
.badge.escalate{background:rgba(90,208,230,.1);color:var(--cyan);border:1px solid rgba(90,208,230,.28)}

/* Segmented risk meter: 20 cells, filled left to right. */
.meter{display:flex;gap:3px;margin:14px 0 8px}
.meter i{flex:1;height:16px;border-radius:2px;background:rgba(255,255,255,.055);
  transform:scaleY(.55);transform-origin:bottom;transition:transform .5s var(--ease),
    background .5s var(--ease),box-shadow .5s var(--ease);transition-delay:var(--d,0ms)}
.meter.on i.lit{transform:scaleY(1);background:var(--meter,var(--mint));
  box-shadow:0 0 12px -3px var(--meter,var(--mint))}
.meter.block{--meter:var(--red)}.meter.warn{--meter:var(--amber)}
.meter.allow{--meter:var(--mint)}.meter.escalate{--meter:var(--cyan)}
.metrics{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--faint);font-family:var(--mono);
  font-size:12px;margin-top:4px}
.metrics b{color:var(--text);font-weight:600}

.finding{border-left:2px solid var(--line-2);padding:2px 0 2px 13px;margin-top:14px}
.finding .sev{font-family:var(--mono);font-size:10.5px;font-weight:700;letter-spacing:.16em;
  text-transform:uppercase}
.sev.critical{color:var(--red)}.sev.high{color:var(--amber)}
.sev.medium{color:var(--muted)}.sev.low,.sev.info{color:var(--faint)}
.finding .t{font-weight:600;font-size:14.5px;margin:3px 0}
.finding .d{color:var(--muted);font-size:13.5px}
.quiet{color:var(--faint);font-size:14px;font-style:italic}

/* --- Steps and lists ---------------------------------------------------- */
ul.plain{margin:0;padding:0;list-style:none;color:var(--muted);display:grid;gap:14px}
ul.plain li{position:relative;padding-left:26px}
ul.plain li::before{content:"";position:absolute;left:4px;top:9px;width:7px;height:7px;
  border-radius:2px;background:var(--mint-dim);transform:rotate(45deg)}
ul.plain strong{color:var(--text)}

.steps{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:8px}
.step{border:1px solid var(--line);border-left:2px solid var(--mint-dim);border-radius:var(--r-md);
  padding:16px 18px;background:rgba(255,255,255,.018)}
.step .n{font-family:var(--mono);font-size:11px;color:var(--mint);letter-spacing:.16em}
.step p{margin:6px 0 0;font-size:14px;color:var(--muted)}

/* --- Tables ------------------------------------------------------------- */
.table-scroll{overflow-x:auto;margin:0 0 18px;border:1px solid var(--line);border-radius:var(--r-md)}
table{width:100%;border-collapse:collapse;font-size:14.5px;margin:0}
.table-scroll table{min-width:520px}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
th{color:var(--faint);font-family:var(--mono);font-weight:600;font-size:11px;text-transform:uppercase;
  letter-spacing:.14em;background:rgba(255,255,255,.02)}
td code{font-size:13px;color:var(--text)}
tbody tr:hover td{background:rgba(255,255,255,.016)}

/* --- Docs table of contents -------------------------------------------- */
.docs-layout{display:grid;gap:32px;grid-template-columns:1fr}
@media(min-width:960px){.docs-layout{grid-template-columns:200px minmax(0,1fr);gap:44px}}
.toc{display:none}
@media(min-width:960px){
  .toc{display:block;position:sticky;top:92px;align-self:start;max-height:calc(100vh - 120px);
    overflow:auto}
  .toc ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
  .toc a{display:block;color:var(--faint);text-decoration:none;font-size:13px;padding:6px 12px;
    border-left:1px solid var(--line);transition:color .18s var(--ease),border-color .18s var(--ease)}
  .toc a:hover{color:var(--text)}
  .toc a.active{color:var(--mint);border-left-color:var(--mint)}
}
.docs-layout section:first-of-type{border-top:none;padding-top:0}

/* --- Rendered markdown (/about) ---------------------------------------- */
.prose{padding:clamp(40px,7vw,64px) 0 24px;max-width:70ch}
.prose h1{font-size:clamp(30px,5vw,46px);margin:0 0 26px}
.prose h2{font-size:clamp(21px,2.8vw,26px);margin:46px 0 14px;padding-top:28px;
  border-top:1px solid var(--line)}
.prose h2:first-of-type{border-top:none;padding-top:0}
.prose h3{font-size:18px;margin:30px 0 8px}
.prose p,.prose li{font-size:16.5px;color:var(--muted);margin:0 0 16px}
.prose li{margin-bottom:10px}
.prose strong{color:var(--text);font-weight:600}
.prose em{color:var(--text);font-style:italic}
.prose hr{border:none;border-top:1px solid var(--line);margin:44px 0}
.prose blockquote{margin:0 0 22px;padding:14px 18px;border-left:2px solid var(--mint);
  border-radius:0 var(--r-sm) var(--r-sm) 0;background:rgba(86,211,160,.05);color:var(--text)}
.prose blockquote p{color:var(--text);margin:0}
.prose code{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xs);
  padding:2px 6px;font-size:13.5px;color:var(--text)}
.prose pre code{background:none;border:none;padding:0}
.prose table{margin:0 0 22px}
.prose ul{padding-left:22px}
.prose td{color:var(--muted)}
.prose td strong{color:var(--text)}

/* Reading progress on long prose. */
.progress{position:fixed;top:0;left:0;height:2px;width:0;z-index:45;
  background:linear-gradient(90deg,var(--mint),var(--cyan));box-shadow:0 0 12px -2px var(--mint)}

/* --- Footer ------------------------------------------------------------- */
footer{padding:44px 0 72px;border-top:1px solid var(--line);color:var(--faint);font-size:13.5px}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--text)}
.foot-top{display:flex;flex-wrap:wrap;gap:14px 26px;align-items:center;margin-bottom:18px}
.foot-top .brand{margin-right:auto}

/* --- Reveal on scroll ---------------------------------------------------
   Gated on the .js class set by the head script, so content is never hidden
   behind JavaScript that did not run. */
.js [data-reveal]{opacity:0;transform:translateY(14px);
  transition:opacity .6s var(--ease),transform .6s var(--ease)}
.js [data-reveal].in{opacity:1;transform:none}

@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important}
  .js [data-reveal]{opacity:1;transform:none}
  .meter i{transform:scaleY(1)}
}
`;

/**
 * Progressive enhancement only.
 *
 * Everything below is additive: with JavaScript off the nav links are all
 * visible, sections are already painted, meters read at full height and the
 * copy buttons are simply absent. Nothing here gates content.
 */
const SCRIPT = `
(function(){
  var d=document,mq=window.matchMedia("(prefers-reduced-motion: reduce)");

  // Meters fill only once visible, so the movement reads as the number landing
  // rather than as decoration that already finished off-screen.
  function fill(meter){
    var risk=Number(meter.getAttribute("data-risk"))||0,
        cells=meter.querySelectorAll("i"),lit=Math.round(risk/100*cells.length);
    cells.forEach(function(cell,i){
      cell.style.setProperty("--d",(mq.matches?0:i*22)+"ms");
      if(i<lit)cell.classList.add("lit");
    });
    meter.classList.add("on");
  }

  var reveal=d.querySelectorAll("[data-reveal]"),meters=d.querySelectorAll(".meter");
  function showAll(){reveal.forEach(function(el){el.classList.add("in");});meters.forEach(fill);}

  // Revealing runs first and owns its own failure: everything below is extra,
  // but a thrown error here would leave the page blank.
  try{
    if(!("IntersectionObserver" in window)){showAll();}
    else{
      var io=new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if(!entry.isIntersecting)return;
          entry.target.classList.add("in");
          entry.target.querySelectorAll(".meter").forEach(fill);
          io.unobserve(entry.target);
        });
      },{rootMargin:"0px 0px -8% 0px",threshold:.08});
      reveal.forEach(function(el){io.observe(el);});
      // Meters outside a revealed container still need filling.
      meters.forEach(function(m){if(!m.closest("[data-reveal]"))fill(m);});
    }
  }catch(e){showAll();}

  var toggle=d.querySelector(".nav-toggle"),links=d.getElementById("nav-links");
  if(toggle&&links){
    toggle.addEventListener("click",function(){
      var open=toggle.getAttribute("aria-expanded")==="true";
      toggle.setAttribute("aria-expanded",String(!open));
      links.classList.toggle("open",!open);
    });
    links.addEventListener("click",function(e){
      if(e.target.tagName==="A"){links.classList.remove("open");
        toggle.setAttribute("aria-expanded","false");}
    });
  }

  d.querySelectorAll(".copy").forEach(function(btn){
    btn.addEventListener("click",function(){
      var block=btn.closest(".term"),pre=block&&block.querySelector("pre");
      if(!pre)return;
      navigator.clipboard.writeText(pre.innerText).then(function(){
        var was=btn.textContent;btn.textContent="copied";btn.setAttribute("data-done","");
        setTimeout(function(){btn.textContent=was;btn.removeAttribute("data-done");},1600);
      },function(){btn.textContent="press \\u2318C";});
    });
  });

  var toc=d.querySelectorAll(".toc a");
  if(toc.length){
    var spy=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(!entry.isIntersecting)return;
        toc.forEach(function(a){
          a.classList.toggle("active",a.getAttribute("href")==="#"+entry.target.id);
        });
      });
    },{rootMargin:"-80px 0px -70% 0px"});
    d.querySelectorAll("section[id]").forEach(function(s){spy.observe(s);});
  }

  var bar=d.querySelector(".progress");
  if(bar){
    var onScroll=function(){
      var h=d.documentElement,max=h.scrollHeight-h.clientHeight;
      bar.style.width=(max>0?(h.scrollTop/max)*100:0)+"%";
    };
    addEventListener("scroll",onScroll,{passive:true});onScroll();
  }
})();
`;

/**
 * Structured data.
 *
 * Emitted so the service is legible to something other than a person reading
 * the page — search results, link previews and the crawlers that build them.
 * It restates what the page already says rather than claiming anything extra.
 */
function jsonLd(path: string, title: string, description: string): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${config.publicUrl}/#organization`,
        name: "Arbiter",
        url: `${config.publicUrl}/`,
        logo: `${config.publicUrl}/icon.png`,
        description: "The judgment layer for autonomous agents.",
      },
      {
        "@type": "WebSite",
        "@id": `${config.publicUrl}/#website`,
        url: `${config.publicUrl}/`,
        name: "Arbiter",
        publisher: { "@id": `${config.publicUrl}/#organization` },
      },
      {
        "@type": "WebPage",
        url: `${config.publicUrl}${path}`,
        name: title,
        description,
        isPartOf: { "@id": `${config.publicUrl}/#website` },
      },
    ],
  };
  // JSON is inlined into a <script> element, where the parser ends the block at
  // the first literal `</script`. Escaping the slash keeps the JSON valid while
  // making that sequence impossible.
  return JSON.stringify(graph).replace(/<\//g, "<\\/");
}

export function page(options: {
  title: string;
  description: string;
  body: string;
  active?: "home" | "about" | "docs";
  /** Absolute path this page is served at, for the canonical and og:url links. */
  path?: string;
  /** Thin scroll indicator, for the one page long enough to need it. */
  progress?: boolean;
  /** Keep the page out of search results. For pages that are not destinations. */
  noindex?: boolean;
}): string {
  const link = (href: string, label: string, key: "home" | "about" | "docs") =>
    `<a href="${href}"${options.active === key ? ' aria-current="page"' : ""}>${label}</a>`;

  const net = config.isMainnet ? "MainNet" : "TestNet";

  // Open Graph and Twitter both require absolute URLs — a relative og:image is
  // dropped silently, so the link preview a person sees when this is shared in
  // Slack or on X comes out blank. Everything social is built off publicUrl.
  const path = options.path ?? "/";
  const canonical = `${config.publicUrl}${path}`;
  const icon = `${config.publicUrl}/icon.png`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(options.title)}</title>
<meta name="description" content="${esc(options.description)}">
<meta name="theme-color" content="#06090d">
<link rel="canonical" href="${esc(canonical)}">
${options.noindex ? '<meta name="robots" content="noindex,follow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<link rel="icon" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<meta property="og:site_name" content="Arbiter">
<meta property="og:title" content="${esc(options.title)}">
<meta property="og:description" content="${esc(options.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(icon)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(options.title)}">
<meta name="twitter:description" content="${esc(options.description)}">
<meta name="twitter:image" content="${esc(icon)}">
<script type="application/ld+json">${jsonLd(path, options.title, options.description)}</script>
<script>document.documentElement.className="js"</script>
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="backdrop" aria-hidden="true"></div>
${options.progress ? '<div class="progress" aria-hidden="true"></div>' : ""}
<nav><div class="wrap">
  <a class="brand" href="/">
    <img src="/icon.png" alt="">
    <span>Arbiter</span>
    <span class="netchip">${esc(net)}</span>
  </a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links">menu</button>
  <div class="nav-links" id="nav-links">
    ${link("/", "Overview", "home")}
    ${link("/about", "What it does", "about")}
    ${link("/docs", "Docs", "docs")}
    <span class="sep" aria-hidden="true"></span>
    <a class="go" href="/invoice/">Invoice</a>
    <a class="go" href="/work/">Review work</a>
  </div>
</div></nav>
<main id="main">${options.body}</main>
<footer><div class="wrap">
  <div class="foot-top">
    <a class="brand" href="/"><img src="/icon.png" alt=""><span>Arbiter</span></a>
    <a href="/docs">Docs</a>
    <a href="/manifest.json">Manifest</a>
    <a href="https://x402.org">x402</a>
    <a href="https://github.com/godwin105/arbiter_AI">Source</a>
  </div>
  <p>Paid per call over x402 on Algorand ${esc(net)}. No accounts, no keys — payment is the
     authentication.</p>
  <p>Agents requesting <code>application/json</code> at <code>/</code> get the manifest, not this page.</p>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}
