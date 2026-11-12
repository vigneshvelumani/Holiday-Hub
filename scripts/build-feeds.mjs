// Fetches every news category's RSS feeds and writes them as static JSON next to
// the built site, so the deployed (static) app can read news from its own origin:
//
//   <outDir>/feeds/<categoryId>.json   one file per category that produced items
//   <outDir>/feeds/index.json          when it ran, item counts and any feed errors
//
// Usage: node scripts/build-feeds.mjs [outDir=dist]
//
// No dependencies and no secrets. The category list is read from the marked block
// in src/lib/services.ts (the single source of truth). Items are passed through as
// the feed states them; nothing is invented, and a category whose feeds all fail
// gets no file at all (the error is recorded in index.json instead).
// Exit code: 0 if at least one category was written, 1 if none was.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVICES = join(ROOT, "src", "lib", "services.ts");

const FETCH_TIMEOUT_MS = 20000;
const MAX_ITEMS_PER_FEED = 40;
const MAX_DESCRIPTION = 6000;
const MAX_CONTENT = 30000;
const CONCURRENCY = 4;

// ── Category list ────────────────────────────────────────────────────────────
/**
 * Reads NEWS_CATEGORIES out of services.ts. That module cannot be imported in
 * Node (it pulls in the browser-only store), so the plain-data block between the
 * `feeds:begin` / `feeds:end` markers is evaluated on its own.
 * @returns {{ id: string; label: string; feeds: string[] }[]}
 */
export function categoriesFromSource(source) {
  const m = /\/\/ feeds:begin[^\n]*\n([\s\S]*?)\/\/ feeds:end/.exec(source);
  if (!m) throw new Error("feeds:begin / feeds:end markers not found in src/lib/services.ts");
  const js = m[1]
    .replace(/^export\s+/gm, "")
    // the only TypeScript in the block is the array's type annotation
    .replace(/(\bNEWS_CATEGORIES)\s*:[^=]*=/, "$1 =");
  const list = new Function(`${js}\nreturn NEWS_CATEGORIES;`)();
  if (!Array.isArray(list) || !list.length) throw new Error("NEWS_CATEGORIES is empty");
  for (const c of list) {
    if (typeof c?.id !== "string" || !/^[a-z0-9-]+$/.test(c.id) || !Array.isArray(c.feeds)) throw new Error(`Unexpected category entry: ${JSON.stringify(c)}`);
    for (const f of c.feeds) if (new URL(f).protocol !== "https:") throw new Error(`Feed is not https: ${f}`);
  }
  return list;
}

// ── A small, tolerant RSS 2.0 reader ─────────────────────────────────────────
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

/** The text content of an element body: CDATA kept as is, everything else un-tagged and entity-decoded. */
function textContent(inner) {
  let out = "";
  let last = 0;
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  const plain = (s) => decodeEntities(s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""));
  for (let m; (m = cdata.exec(inner)); last = cdata.lastIndex) out += plain(inner.slice(last, m.index)) + m[1];
  return (out + plain(inner.slice(last))).trim();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ATTRS = `((?:"[^"]*"|'[^']*'|[^>"'])*?)`;

/** Every `<tag …>` in `xml`, with its attributes and (for non-empty elements) its body. */
function elements(xml, tag) {
  const open = new RegExp(`<${esc(tag)}(?=[\\s>/])${ATTRS}(/?)>`, "gi");
  const out = [];
  for (let m; (m = open.exec(xml)); ) {
    const attrs = {};
    for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? "").trim();
    let inner = "";
    if (!m[2]) {
      const close = new RegExp(`</${esc(tag)}\\s*>`, "i").exec(xml.slice(open.lastIndex));
      if (close) {
        inner = xml.slice(open.lastIndex, open.lastIndex + close.index);
        open.lastIndex += close.index + close[0].length;
      }
    }
    out.push({ attrs, inner });
  }
  return out;
}

const httpsUrl = (u) => {
  if (!u) return undefined;
  try {
    const url = new URL(u.startsWith("//") ? "https:" + u : u);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const isImage = (a) => {
  const kind = a.medium || a.type || "";
  return !kind || /^image/i.test(kind);
};

/**
 * Parses an RSS document into the fields the client's own feed reader extracts
 * (see `FeedFields` in src/lib/services.ts). Throws if it is not an RSS feed.
 */
export function parseRss(xml) {
  if (typeof xml !== "string" || !/<rss[\s>]|<rdf:RDF[\s>]|<channel[\s>]/i.test(xml)) throw new Error("not an RSS document");
  const items = [];
  for (const { inner } of elements(xml, "item")) {
    const text = (tag) => {
      const el = elements(inner, tag)[0];
      return el ? textContent(el.inner) : "";
    };
    const title = text("title");
    const link = text("link") || text("guid");
    if (!title || !/^https?:\/\//.test(link)) continue;
    const when = Date.parse(text("pubDate") || text("dc:date"));
    const image =
      [...elements(inner, "media:content"), ...elements(inner, "media:thumbnail"), ...elements(inner, "enclosure")]
        .filter((e) => isImage(e.attrs))
        .map((e) => httpsUrl(e.attrs.url))
        .find(Boolean) || undefined;
    const item = {
      title,
      link,
      pubDate: Number.isFinite(when) ? new Date(when).toISOString() : null,
      description: text("description").slice(0, MAX_DESCRIPTION),
    };
    const content = text("content:encoded");
    if (content) item.content = content.slice(0, MAX_CONTENT);
    const source = text("source");
    if (source) item.source = source;
    const author = text("dc:creator") || text("author");
    if (author) item.author = author;
    if (image) item.image = image;
    items.push(item);
  }
  return items;
}

// ── Fetching ─────────────────────────────────────────────────────────────────
async function fetchFeed(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (rss reader)", accept: "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const items = parseRss(await r.text());
      if (!items.length) throw new Error("feed has no items");
      return items.slice(0, MAX_ITEMS_PER_FEED);
    } catch (e) {
      lastError = e?.name === "TimeoutError" ? new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000}s`) : e;
      if (attempt === 0) await new Promise((done) => setTimeout(done, 1500));
    }
  }
  const cause = lastError?.cause?.code || lastError?.cause?.message;
  throw new Error([lastError?.message || String(lastError), cause].filter(Boolean).join(": "));
}

async function pool(jobs, size) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await jobs[i]().then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error: error?.message || String(error) }),
        );
      }
    }),
  );
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export async function buildFeeds(outDir, categories, log = console.log) {
  const dir = join(outDir, "feeds");
  await mkdir(dir, { recursive: true });
  const urls = [...new Set(categories.flatMap((c) => c.feeds))];
  const fetched = new Map((await pool(urls.map((u) => () => fetchFeed(u)), CONCURRENCY)).map((r, i) => [urls[i], r]));

  const generatedAt = new Date().toISOString();
  const index = { generatedAt, written: 0, categories: {} };
  for (const c of categories) {
    if (!c.feeds.length) {
      index.categories[c.id] = { label: c.label, items: 0, written: false, skipped: "no RSS feeds (served by another source)", feeds: [] };
      log(`- ${c.id}: skipped (no RSS feeds)`);
      continue;
    }
    const feeds = c.feeds.map((url) => {
      const r = fetched.get(url);
      return r.ok ? { url, ok: true, items: r.value.length } : { url, ok: false, items: 0, error: r.error };
    });
    const seen = new Set();
    const items = c.feeds
      .flatMap((url) => (fetched.get(url).ok ? fetched.get(url).value.map((it) => ({ ...it, feed: url })) : []))
      .filter((it) => !seen.has(it.link) && seen.add(it.link));
    const written = items.length > 0;
    if (written) {
      await writeFile(join(dir, `${c.id}.json`), JSON.stringify({ id: c.id, label: c.label, generatedAt, feeds, items }));
      index.written++;
    }
    index.categories[c.id] = { label: c.label, items: items.length, written, feeds, ...(written ? {} : { error: "all feeds failed; no file written" }) };
    log(`${written ? "+" : "!"} ${c.id}: ${items.length} items${written ? "" : " — NOT written"}`);
    for (const f of feeds) if (!f.ok) log(`    failed ${f.url} — ${f.error}`);
  }
  await writeFile(join(dir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = resolve(process.argv[2] || "dist");
  try {
    const categories = categoriesFromSource(await readFile(SERVICES, "utf8"));
    const index = await buildFeeds(outDir, categories);
    console.log(`${index.written} categor${index.written === 1 ? "y" : "ies"} written to ${join(outDir, "feeds")}`);
    if (!index.written) {
      console.error("No category could be fetched; no feed files were written.");
      process.exitCode = 1;
    }
  } catch (e) {
    console.error("build-feeds failed:", e?.message || e);
    process.exitCode = 1;
  }
}
