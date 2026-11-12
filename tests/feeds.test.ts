// Offline checks for scripts/build-feeds.mjs: the category list it reads out of
// services.ts, the RSS parser, and the "never write a fake file" rule.
// Run with: node tests/feeds.test.ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore — plain .mjs build script, no type declarations
import { buildFeeds, categoriesFromSource, parseRss } from "../scripts/build-feeds.mjs";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log("ok   " + name);
}

const RSS_HOSTS = new Set(["news.google.com", "www.thehindu.com", "feeds.bbci.co.uk", "rss.nytimes.com"]);

await check("category list is read from services.ts", async () => {
  const cats = categoriesFromSource(await readFile(new URL("../src/lib/services.ts", import.meta.url), "utf8"));
  assert.ok(cats.length >= 10);
  assert.equal(new Set(cats.map((c: any) => c.id)).size, cats.length, "ids are unique");
  assert.ok(cats.some((c: any) => c.id === "india" && c.feeds.length > 0));
  for (const c of cats) for (const f of c.feeds) assert.ok(RSS_HOSTS.has(new URL(f).hostname), `${f} is on a host the dev relay allows`);
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel><title>Channel title</title><link>https://example.com/</link>
<atom:link href="https://example.com/rss" rel="self"/>
<item>
  <title><![CDATA[Rain &amp; floods: "red alert" in 3 districts]]></title>
  <link>https://example.com/a?x=1&amp;y=2</link>
  <description><![CDATA[<p>Heavy rain <b>expected</b>.</p>]]></description>
  <pubDate>Wed, 11 Nov 2026 10:30:00 +0530</pubDate>
  <dc:creator>A. Reporter</dc:creator>
  <media:content url="http://example.com/insecure.jpg" medium="image"/>
  <media:content medium="image" url="https://example.com/pic.jpg?w=1&amp;h=2" width="1200"/>
  <content:encoded><![CDATA[<p>Full text here.</p>]]></content:encoded>
</item>
<item>
  <title>Markets &lt;rally&gt; &#8211; Example Times</title>
  <link>https://example.com/b</link>
  <description>&lt;a href="https://example.com/b"&gt;Markets rally&lt;/a&gt;</description>
  <pubDate>not a date</pubDate>
  <source url="https://times.example.com">Example Times</source>
  <enclosure url="https://example.com/audio.mp3" type="audio/mpeg" length="1"/>
  <media:thumbnail url="https://example.com/thumb.png"/>
</item>
<item><title>No link, so it is dropped</title><description>x</description></item>
<item><title></title><link>https://example.com/untitled</link></item>
</channel></rss>`;

await check("parser reads titles, links, dates, authors, sources and images", () => {
  const items = parseRss(SAMPLE);
  assert.equal(items.length, 2, "items without a title or link are skipped");
  const [a, b] = items;
  assert.equal(a.title, 'Rain &amp; floods: "red alert" in 3 districts', "CDATA is kept verbatim");
  assert.equal(a.link, "https://example.com/a?x=1&y=2");
  assert.equal(a.description, "<p>Heavy rain <b>expected</b>.</p>");
  assert.equal(a.pubDate, "2026-11-11T05:00:00.000Z");
  assert.equal(a.author, "A. Reporter");
  assert.equal(a.image, "https://example.com/pic.jpg?w=1&h=2", "http images are skipped, https kept");
  assert.equal(a.content, "<p>Full text here.</p>");
  assert.equal(b.title, "Markets <rally> – Example Times");
  assert.equal(b.description, '<a href="https://example.com/b">Markets rally</a>');
  assert.equal(b.pubDate, null, "an unparseable date becomes null");
  assert.equal(b.source, "Example Times");
  assert.equal(b.image, "https://example.com/thumb.png", "a non-image enclosure is not an image");
  assert.equal(b.author, undefined);
});

await check("parser rejects things that are not RSS", () => {
  assert.throws(() => parseRss("<!doctype html><html><body>Too many requests</body></html>"));
  assert.throws(() => parseRss(""));
  assert.deepEqual(parseRss("<rss><channel><title>empty</title></channel></rss>"), []);
});

await check("a category whose feeds all fail gets no file, only an index entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "feeds-test-"));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("good")) return new Response(SAMPLE, { status: 200 });
    return new Response("nope", { status: 503 });
  }) as typeof fetch;
  // skip the retry pause
  const realTimeout = globalThis.setTimeout;
  (globalThis as any).setTimeout = (fn: () => void) => realTimeout(fn, 0);
  try {
    const index = await buildFeeds(
      dir,
      [
        { id: "works", label: "Works", feeds: ["https://good.example/rss", "https://bad.example/rss"] },
        { id: "broken", label: "Broken", feeds: ["https://bad.example/rss"] },
        { id: "other", label: "Other source", feeds: [] },
      ],
      () => {},
    );
    assert.deepEqual((await readdir(join(dir, "feeds"))).sort(), ["index.json", "works.json"]);
    assert.equal(index.written, 1);
    assert.equal(index.categories.works.items, 2);
    assert.equal(index.categories.works.feeds[1].ok, false);
    assert.match(index.categories.works.feeds[1].error, /503/);
    assert.equal(index.categories.broken.written, false);
    assert.ok(index.categories.broken.error);
    const file = JSON.parse(await readFile(join(dir, "feeds", "works.json"), "utf8"));
    assert.equal(file.items.length, 2);
    assert.equal(file.items[0].feed, "https://good.example/rss");
    assert.ok(Number.isFinite(Date.parse(file.generatedAt)));
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
    await rm(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} feed checks passed`);
