// Lê as páginas oficiais do Suno, guarda as novidades em knowledge/suno-feed.json
// e, se aparecer um modelo mais novo do que o do pacote de conhecimento, abre um aviso (issue).
// Só lê páginas públicas e oficiais; não usa nenhuma API privada.
import fs from "node:fs";

const SOURCES = [
  { id: "release-notes", url: "https://suno.com/release-notes", match: /\/release-notes\/[a-z0-9-]+/i },
  { id: "blog", url: "https://suno.com/blog", match: /\/blog\/[a-z0-9-]+/i },
  { id: "help", url: "https://help.suno.com/en", match: /\/en\/articles\/\d+[a-z0-9-]*/i },
  { id: "sitemap", url: "https://suno.com/sitemap.xml", match: /\/(release-notes|blog)\/[a-z0-9-]+/i }
];
const UA = "Mozilla/5.0 (compatible; SUNANDO-monitor/1.0; +https://github.com/fernexdesigner-cmyk/SUNANDO)";
const FEED = "knowledge/suno-feed.json", PACK = "knowledge/suno-pack.json";

const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const pack = JSON.parse(fs.readFileSync(PACK, "utf8"));
const known = new Map((feed.items || []).map((i) => [i.url, i]));
const verNum = (v) => { const m = String(v || "").match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const slugTitle = (u) => decode(u.split("/").filter(Boolean).pop().replace(/^\d+-?/, "").replace(/-/g, " ")).replace(/^./, (c) => c.toUpperCase());

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml" }, redirect: "follow" });
  return { status: r.status, text: r.ok ? await r.text() : "" };
}

const statuses = [];
const fresh = [];
for (const s of SOURCES) {
  let res;
  try { res = await get(s.url); } catch (e) { res = { status: 0, text: "" }; }
  statuses.push({ id: s.id, url: s.url, status: res.status, ok: res.status === 200 });
  if (!res.text) continue;
  const base = new URL(s.url);
  const found = new Map();
  // links with visible text: <a href="...">Title</a>
  for (const m of res.text.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href; try { href = new URL(decode(m[1]), base).toString().split("#")[0]; } catch { continue; }
    if (!s.match.test(new URL(href).pathname)) continue;
    const t = decode(m[2].replace(/<[^>]+>/g, " "));
    if (!found.has(href) || (t && t.length > (found.get(href) || "").length)) found.set(href, t);
  }
  // sitemap / raw paths
  for (const m of res.text.matchAll(/https?:\/\/[^\s"<>]+/g)) {
    const href = m[0].split("#")[0];
    try { if (new URL(href).hostname.endsWith("suno.com") && s.match.test(new URL(href).pathname) && !found.has(href)) found.set(href, ""); } catch {}
  }
  for (const [url, t] of found) {
    const title = (t && t.length > 3 && t.length < 180 ? t : slugTitle(url));
    if (!known.has(url)) { const item = { url, title, source: s.id, firstSeen: new Date().toISOString().slice(0, 10) }; known.set(url, item); fresh.push(item); }
    else if (t && t.length > 3 && known.get(url).title !== t && t.length < 180) known.get(url).title = t;
  }
}

// model versions mentioned in titles, e.g. "v7", "Introducing v7", "version 7.5"
let maxSeen = verNum(feed.latestModelSeen || pack.latestModel);
const detected = new Set(feed.detected || []);
for (const i of known.values()) {
  for (const m of i.title.matchAll(/\b(?:v|version\s)(\d{1,2}(?:\.\d)?)\b/gi)) {
    const n = parseFloat(m[1]);
    if (n > maxSeen && n < 50) maxSeen = n;
    if (n > verNum(pack.latestModel) && n < 50) detected.add("v" + m[1]);
  }
}

const items = [...known.values()].sort((a, b) => (b.firstSeen || "").localeCompare(a.firstSeen || "")).slice(0, 300);
const out = { checked: new Date().toISOString(), sources: statuses, items, latestModelSeen: "v" + maxSeen, detected: [...detected].sort() };
fs.writeFileSync(FEED, JSON.stringify(out, null, 2) + "\n");

const newer = [...detected].filter((v) => verNum(v) > verNum(pack.latestModel));
fs.writeFileSync("monitor-result.json", JSON.stringify({ fresh: fresh.length, freshItems: fresh.slice(0, 20), newer, statuses }, null, 2));
console.log(`Fontes: ${statuses.map((s) => s.id + "=" + s.status).join(", ")}`);
console.log(`Itens no feed: ${items.length}, novos agora: ${fresh.length}, modelo mais novo visto: v${maxSeen}`);
if (newer.length) console.log(`NOVA VERSÃO DETECTADA: ${newer.join(", ")}`);
