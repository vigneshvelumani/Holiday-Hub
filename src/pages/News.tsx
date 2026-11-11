// News: an editorial front page per category (or search), then a focused in-app reader.
// Feeds provide a headline, image, author, time and an excerpt (occasionally the
// full text). The reader shows all of that; the publisher's page is one click away
// for anything the feed does not carry. No article text is scraped or invented.

import "./news.css";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark as BookmarkIcon, BookmarkCheck, Clock, ListFilter, Newspaper, RefreshCw, Search, Share2, X } from "lucide-react";
import { useNow } from "../lib/clock.ts";
import { toast } from "../lib/notify.ts";
import { NEWS_CATEGORIES, getArticle, newsCategory, newsSearchFeed, rememberArticles, useNews, type NewsItem } from "../lib/services.ts";
import { removeItem, saveItem, useData, type Bookmark } from "../lib/store.ts";
import { ErrorNote, useUi } from "../components/ui.tsx";
import { timeAgo } from "./Dashboard.tsx";

const articleIdFromHash = () => location.hash.match(/^#\/news\/a\/([a-z0-9]+)/)?.[1] || null;
const catLabel = (id: string) => (id === "search" ? "Search result" : id === "saved" ? "Saved" : newsCategory(id)?.label || "News");
const fromBookmark = (b: Bookmark): NewsItem => ({ id: b.id, title: b.title, link: b.link, source: b.source, pubDate: b.pubDate, summary: b.summary, image: b.image, category: b.category || "saved", related: [] });
const stamp = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

/** Clock time for today's stories, the date for older ones. */
function shortWhen(iso: string | null): string {
  const t = stamp(iso);
  if (!t) return "";
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function useBookmarks() {
  const { bookmarks } = useData();
  const has = (id: string) => bookmarks.some((b) => b.id === id);
  const toggle = (n: NewsItem) => {
    if (has(n.id)) {
      removeItem("bookmarks", n.id);
      toast("Removed from saved articles");
    } else {
      saveItem("bookmarks", { id: n.id, link: n.link, title: n.title, source: n.source, pubDate: n.pubDate, summary: n.summary, image: n.image, category: n.category, savedAt: Date.now() } as Bookmark & { link: string });
      toast("Article saved", "Find it under Saved.", "ok");
    }
  };
  return { bookmarks, has, toggle };
}
type Marks = ReturnType<typeof useBookmarks>;

function Meta({ n, extra }: { n: NewsItem; extra?: string }) {
  return (
    <span className="meta nw-meta">
      {n.source && <span className="src">{n.source}</span>}
      {n.pubDate && stamp(n.pubDate) > 0 && <time dateTime={new Date(n.pubDate).toISOString()}>{timeAgo(n.pubDate)}</time>}
      {n.tag && <span>{n.tag}</span>}
      {extra && <span>{extra}</span>}
    </span>
  );
}

/** The publisher's own picture, or — when there is none or it fails — nothing / a typographic tile. Never a stand-in photo. */
function Pic({ n, eager, tile }: { n: NewsItem; eager?: boolean; tile?: boolean }) {
  const [bad, setBad] = useState(false);
  if (n.image && !bad) {
    return (
      <span className="nw-pic">
        <img src={n.image} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
      </span>
    );
  }
  return tile ? <span className="nw-pic nw-pic-none" aria-hidden><span>{n.source || "News"}</span></span> : null;
}

function SaveButton({ n, marks }: { n: NewsItem; marks: Marks }) {
  const on = marks.has(n.id);
  return (
    <button type="button" className="nw-save" aria-pressed={on} aria-label={`${on ? "Saved — remove from saved articles" : "Save article"}: ${n.title}`} title={on ? "Saved — select to remove" : "Save for later"} onClick={() => marks.toggle(n)}>
      {on ? <BookmarkCheck size={17} /> : <BookmarkIcon size={17} />}
    </button>
  );
}

type Variant = "lead" | "side" | "trio" | "duo" | "latest" | "more" | "result";
function Story({ n, variant, marks, kicker, eager }: { n: NewsItem; variant: Variant; marks: Marks; kicker?: string; eager?: boolean }) {
  const ui = useUi();
  const lead = variant === "lead";
  const withSummary = lead || variant === "duo" || variant === "result" || (variant === "side" && !n.image);
  const extra = n.related.length ? (lead ? `covered by ${n.related.length + 1} publishers` : `+${n.related.length} publishers`) : undefined;
  return (
    <article className={`nw-item nw-v-${variant}${n.image ? "" : " nw-noimg"}`}>
      <button type="button" className={(lead ? "lead" : "story") + " nw-story"} onClick={() => ui.readArticle(n.id)}>
        {variant === "latest" && <span className="nw-when num">{shortWhen(n.pubDate) || "—"}</span>}
        {variant !== "latest" && <Pic n={n} eager={eager} tile={variant === "trio"} />}
        <span className="nw-text">
          {kicker && <span className="eyebrow nw-kicker">{kicker}</span>}
          {lead ? <h2>{n.title}</h2> : <h3>{n.title}</h3>}
          {withSummary && n.summary && <p>{lead ? clip(n.summary, 280) : n.summary}</p>}
          <Meta n={n} extra={extra} />
        </span>
      </button>
      <SaveButton n={n} marks={marks} />
    </article>
  );
}

// ── category tabs: roving tabindex, Left/Right/Home/End ──────────────────────
function CategoryTabs({ value, onChange, saved }: { value: string; onChange: (id: string) => void; saved: number }) {
  const ids = useMemo(() => [...NEWS_CATEGORIES.map((c) => c.id), "saved"], []);
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    // keep the selected tab in view without moving the page
    const el = refs.current[value];
    const b = box.current;
    if (!el || !b) return;
    const left = el.offsetLeft - b.offsetLeft;
    if (left < b.scrollLeft + 24) b.scrollLeft = Math.max(0, left - 24);
    else if (left + el.offsetWidth > b.scrollLeft + b.clientWidth - 24) b.scrollLeft = left + el.offsetWidth - b.clientWidth + 24;
  }, [value]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = Math.max(0, ids.indexOf(value));
    const j = e.key === "ArrowRight" ? (i + 1) % ids.length : e.key === "ArrowLeft" ? (i - 1 + ids.length) % ids.length : e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    onChange(ids[j]);
    refs.current[ids[j]]?.focus();
  };
  return (
    <div className="tabs2 nw-tabs" role="tablist" aria-label="News categories" ref={box} onKeyDown={onKey}>
      {ids.map((id) => (
        <button key={id} type="button" role="tab" id={"nw-tab-" + id} aria-selected={value === id} aria-controls="nw-panel" tabIndex={value === id ? 0 : -1} ref={(el) => void (refs.current[id] = el)} onClick={() => onChange(id)}>
          {id === "saved" ? <><BookmarkIcon size={14} aria-hidden /> Saved ({saved})</> : newsCategory(id)!.label}
        </button>
      ))}
    </div>
  );
}

// ── the front page for one category ──────────────────────────────────────────
function FrontPage({ items, marks, label, trending }: { items: NewsItem[]; marks: Marks; label: string; trending: boolean }) {
  const plan = useMemo(() => {
    const lead = items.find((n) => n.image && n.summary) || items[0];
    const pool = items.filter((n) => n !== lead);
    const side = pool.slice(0, 3);
    const after = pool.slice(3);
    const pictured = after.filter((n) => n.image);
    const trio = pictured.length >= 3 ? pictured.slice(0, 3) : [];
    const duo = pictured.length >= 5 ? pictured.slice(3, 5) : [];
    const used = new Set([...trio, ...duo]);
    const remaining = after.filter((n) => !used.has(n));
    const latest = [...remaining].sort((a, b) => stamp(b.pubDate) - stamp(a.pubDate)).slice(0, trio.length ? 8 : 10);
    const inLatest = new Set(latest);
    const more = remaining.filter((n) => !inLatest.has(n));
    return { lead, side, trio, duo, latest, more };
  }, [items]);
  const { lead, side, trio, duo, latest, more } = plan;
  if (!lead) return null;
  return (
    <>
      <section className={"nw-top" + (side.length ? "" : " nw-solo")} aria-label="Top stories">
        <Story n={lead} variant="lead" marks={marks} kicker={trending ? "Most covered right now" : "Top story"} eager />
        {side.length > 0 && (
          <div className="nw-rail">
            {side.map((n) => <Story key={n.id} n={n} variant="side" marks={marks} />)}
          </div>
        )}
      </section>

      {(trio.length > 0 || latest.length > 0) && (
        <div className={"nw-mid" + (trio.length ? "" : " nw-textonly")}>
          {trio.length > 0 && (
            <section className="nw-features" aria-labelledby="nw-h-features">
              <h2 id="nw-h-features" className="nw-sec">Also in {label}</h2>
              <div className="nw-trio">{trio.map((n) => <Story key={n.id} n={n} variant="trio" marks={marks} />)}</div>
              {duo.length > 0 && <div className="nw-duo">{duo.map((n) => <Story key={n.id} n={n} variant="duo" marks={marks} />)}</div>}
            </section>
          )}
          {latest.length > 0 && (
            <section className="nw-latest" aria-labelledby="nw-h-latest">
              <h2 id="nw-h-latest" className="nw-sec">{trending ? "Trending" : "Latest"}</h2>
              <div className="nw-latest-list">{latest.map((n) => <Story key={n.id} n={n} variant="latest" marks={marks} />)}</div>
            </section>
          )}
        </div>
      )}

      {more.length > 0 && (
        <section aria-labelledby="nw-h-more">
          <h2 id="nw-h-more" className="nw-sec">More from {label} <span className="nw-count">{more.length} stor{more.length === 1 ? "y" : "ies"}</span></h2>
          <div className="nw-more">{more.map((n) => <Story key={n.id} n={n} variant="more" marks={marks} />)}</div>
        </section>
      )}
    </>
  );
}

function FrontSkeleton() {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => (
    <div key={i} className="nw-sk-row"><div className="skeleton" style={{ height: 18 }} /><div className="skeleton" style={{ height: 18, width: "72%" }} /><div className="skeleton" style={{ height: 12, width: "38%" }} /></div>
  ));
  return (
    <div role="status" aria-busy="true" aria-label="Loading stories">
      <div className="nw-top">
        <div className="nw-sk-lead">
          <div className="skeleton nw-sk-pic" />
          <div className="skeleton" style={{ height: 30, width: "92%" }} />
          <div className="skeleton" style={{ height: 30, width: "64%" }} />
          <div className="skeleton" style={{ height: 14, width: "40%" }} />
        </div>
        <div className="nw-rail">{lines(3)}</div>
      </div>
      <div className="nw-mid">
        <div className="nw-trio">{Array.from({ length: 3 }, (_, i) => <div key={i} className="nw-sk-row"><div className="skeleton nw-sk-thumb" /><div className="skeleton" style={{ height: 18 }} /><div className="skeleton" style={{ height: 12, width: "50%" }} /></div>)}</div>
        <div>{lines(3)}</div>
      </div>
    </div>
  );
}

// ── reader ───────────────────────────────────────────────────────────────────
function rank(n: NewsItem, pool: NewsItem[]): NewsItem[] {
  const words = (n.title + " " + n.summary).toLowerCase().match(/[a-z]{5,}/g) || [];
  return pool
    .filter((x) => x.id !== n.id)
    .map((x) => ({ x, score: words.filter((w) => x.title.toLowerCase().includes(w)).length + (x.category === n.category ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.x);
}

function RelatedList({ n, pool, label }: { n: NewsItem; pool: NewsItem[]; label: string }) {
  const ui = useUi();
  const more = rank(n, pool);
  if (!more.length) return null;
  return (
    <section aria-labelledby="h-more" className="nw-related">
      <h2 id="h-more" className="nw-sec">{label}</h2>
      <div className="nw-rel-grid">
        {more.map((x) => (
          <button key={x.id} type="button" className="story nw-story nw-rel" onClick={() => ui.readArticle(x.id)}>
            <Pic n={x} />
            <span className="nw-text">
              <h3>{x.title}</h3>
              <Meta n={x} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
/** Related stories come from the article's own category (cached by the news hook), not whichever tab happens to be open. */
function RelatedFromCategory({ n, pool, id, feeds, label }: { n: NewsItem; pool: NewsItem[]; id: string; feeds: string[]; label: string }) {
  const { data } = useNews(id, feeds);
  return <RelatedList n={n} pool={data && data.length > 1 ? data : pool} label={data && data.length > 1 ? `More from ${label}` : "Related articles"} />;
}

function Reader({ id, pool }: { id: string; pool: NewsItem[] }) {
  const ui = useUi();
  const { bookmarks, has, toggle } = useBookmarks();
  const saved = bookmarks.find((b) => b.id === id) as (Bookmark & { link?: string }) | undefined;
  const n = getArticle(id) || (saved && saved.link ? fromBookmark(saved as Bookmark & { link: string }) : undefined);
  const [progress, setProgress] = useState(0);
  const [imgBad, setImgBad] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const on = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      setProgress(max > 40 ? Math.min(1, scrollY / max) : 1);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => (window.removeEventListener("scroll", on), window.removeEventListener("resize", on));
  }, [id]);

  const back = () => (history.length > 1 && document.referrer === "" ? history.back() : (location.hash = "/news"));
  if (!n) {
    return (
      <div className="page nw-page nw-reader">
        <div className="reader-page nw-gone" role="alert">
          <Newspaper size={30} strokeWidth={1.5} aria-hidden />
          <h1>This article is no longer available</h1>
          <p>It has dropped out of the live feed and wasn't saved in this browser. Go back to the news list to see the latest stories.</p>
          <button type="button" className="btn primary" onClick={() => (location.hash = "/news")}><ArrowLeft size={15} /> Back to news</button>
        </div>
      </div>
    );
  }
  const share = async () => {
    const data = { title: n.title, text: `${n.title} — ${n.source}`, url: n.link };
    if (navigator.share) {
      try {
        await navigator.share(data);
      } catch {
        /* cancelled or blocked */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(n.link);
      toast("Link copied", n.source, "ok");
    } catch {
      toast("Couldn't copy the link", "Clipboard access was blocked. Use Open original instead.", "warn");
    }
  };
  const body = n.content?.length ? n.content : n.summary ? [n.summary] : [];
  const full = !!n.content?.length;
  // a reading time is only stated for text the feed actually carries in full
  const wordCount = full ? body.join(" ").split(/\s+/).filter(Boolean).length : 0;
  const minutes = wordCount >= 120 ? Math.max(1, Math.round(wordCount / 220)) : 0;
  const savedNow = has(n.id);
  const cat = newsCategory(n.category);
  const publisher = n.source || "the publisher";
  const when = n.pubDate && stamp(n.pubDate) ? new Date(n.pubDate) : null;

  return (
    <div className="page nw-page nw-reader">
      <div className="progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ transform: `scaleX(${progress})` }} /></div>
      <article className="reader-page">
        <div className="reader-bar nw-bar">
          <button type="button" className="btn" onClick={back}><ArrowLeft size={16} /> <span>Back<span className="nw-wide"> to news</span></span></button>
          <span className="grow" />
          <button type="button" className="btn" onClick={() => toggle(n)} aria-pressed={savedNow} aria-label={savedNow ? "Saved — remove from saved articles" : "Save this article"}>{savedNow ? <BookmarkCheck size={16} /> : <BookmarkIcon size={16} />} <span className="nw-wide">{savedNow ? "Saved" : "Save"}</span></button>
          <button type="button" className="btn" onClick={share} aria-label="Share this article"><Share2 size={16} /> <span className="nw-wide">Share</span></button>
          <a className="btn primary" href={n.link} target="_blank" rel="noopener noreferrer" aria-label={`Open original at ${publisher} (opens in a new tab)`}><span>Open original</span> <ArrowUpRight size={15} /></a>
        </div>

        <header className="nw-head">
          <div className="eyebrow nw-kicker">{catLabel(n.category)}{n.source ? <> <span aria-hidden>·</span> {n.source}</> : null}</div>
          <h1>{n.title}</h1>
          <div className="nw-byline">
            {n.author && <span>By <strong>{n.author}</strong></span>}
            {when && <time dateTime={when.toISOString()}>{when.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" })} <span className="muted">({timeAgo(n.pubDate!)})</span></time>}
            {minutes > 0 ? <span><Clock size={13} aria-hidden /> {minutes} min read</span> : !full && body.length > 0 ? <span>Excerpt from the publisher's feed</span> : null}
          </div>
        </header>

        {n.image && !imgBad && (
          <figure className="nw-hero">
            <span className="nw-pic"><img src={n.image} alt="" referrerPolicy="no-referrer" onError={() => setImgBad(true)} /></span>
            <figcaption>Image: {publisher}</figcaption>
          </figure>
        )}

        <div className="body nw-body">
          {body.length > 0 ? body.map((p, i) => <p key={i}>{p}</p>) : <p className="nw-thin">The publisher's feed gives only the headline for this story.</p>}
        </div>

        <aside className="nw-pub" aria-label="Where the full article is">
          <div>
            <div className="nw-pub-title">{full ? `This is the text ${publisher} publishes in its feed` : `The full story is on ${publisher}'s site`}</div>
            <p>
              {full
                ? `Shown exactly as provided by ${publisher}'s feed. Pictures, updates and anything else are on the original page.`
                : `${n.source || "The publisher"} shares a summary in its feed, not the whole article, so that is what can be shown here. Holiday Hub does not copy or rewrite articles — the complete story is on their site.`}
            </p>
          </div>
          <a className="btn primary nw-pub-go" href={n.link} target="_blank" rel="noopener noreferrer">{full ? "View original" : "Read the full story"} <ArrowUpRight size={16} /><span className="sr"> at {publisher} (opens in a new tab)</span></a>
        </aside>

        {n.related.length > 0 && (
          <section aria-labelledby="h-rel" className="nw-related">
            <h2 id="h-rel" className="nw-sec">Other publishers on this story</h2>
            <ul className="nw-others">
              {n.related.map((r) => (
                <li key={r.link}>
                  <a href={r.link} target="_blank" rel="noopener noreferrer">
                    <span className="nw-text">
                      <span className="nw-o-title">{r.title}</span>
                      <span className="meta nw-meta"><span className="src">{r.source}</span><span className="sr"> (opens in a new tab)</span></span>
                    </span>
                    <ArrowUpRight size={16} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {cat ? <RelatedFromCategory n={n} pool={pool} id={cat.id} feeds={cat.feeds} label={cat.label} /> : <RelatedList n={n} pool={pool} label="Related articles" />}

        <div className="nw-end">
          <button type="button" className="link" onClick={() => ui.go("news")}><ArrowLeft size={14} /> All news</button>
        </div>
      </article>
    </div>
  );
}

// ── list ─────────────────────────────────────────────────────────────────────
export function NewsPage() {
  useNow(60000); // keeps "updated … ago" current
  const [reading, setReading] = useState(articleIdFromHash);
  const [cat, setCat] = useState("india");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const marks = useBookmarks();
  const { bookmarks } = marks;
  useEffect(() => {
    const on = () => setReading(articleIdFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const showSaved = cat === "saved" && !query;
  const c = newsCategory(showSaved ? "india" : cat) || NEWS_CATEGORIES[0];
  const feeds = useMemo(() => (query ? [newsSearchFeed(query)] : c.feeds), [query, c]);
  const { data, loading, error, stale, refresh, updatedAt } = useNews(query ? "search:" + query : c.id, feeds);
  const savedItems = useMemo(() => [...bookmarks].sort((a, b) => b.savedAt - a.savedAt).map((b) => fromBookmark(b as Bookmark & { link: string })), [bookmarks]);
  useEffect(() => rememberArticles(savedItems), [savedItems]);
  const source = showSaved ? savedItems : data || [];
  const f = filter.trim().toLowerCase();
  const shown = source.filter((n) => !f || (n.title + " " + n.source + " " + n.summary).toLowerCase().includes(f));

  if (reading) return <Reader id={reading} pool={source} key={reading} />;

  const front = !showSaved && !query && !f;
  const firstLoad = !showSaved && loading && !data;
  const failed = !showSaved && !!error && !data;
  const label = query ? "Search results" : showSaved ? "Saved articles" : c.label;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="page nw-page">
      <div className="page-head nw-mast">
        <div className="nw-mast-main">
          <h1 className="page-title">News</h1>
          <div className="nw-status">
            <p className="page-sub" role="status">
              {showSaved
                ? `${savedItems.length} saved article${savedItems.length === 1 ? "" : "s"}, kept in this browser`
                : <><span className="nw-live"><i aria-hidden /> Live</span> {loading && !updatedAt ? "Fetching the latest headlines…" : updatedAt ? `Updated ${timeAgo(updatedAt)}` : "From publisher feeds"} <span className="nw-auto">· refreshes by itself every 10 minutes</span></>}
            </p>
            {!showSaved && <button type="button" className="btn sm nw-refresh" onClick={refresh} disabled={loading} title="Only needed if the headlines look out of date"><RefreshCw size={14} className={loading ? "spin" : ""} /> {loading ? "Updating…" : "Refresh now"}</button>}
          </div>
        </div>
        <form className="nw-search" role="search" onSubmit={(e) => (e.preventDefault(), setQuery(input.trim()))}>
          <div className="search">
            <Search size={16} aria-hidden />
            <input className="input" type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search the news…" aria-label="Search all news" enterKeyHint="search" />
          </div>
          <button className="btn primary" type="submit" disabled={!input.trim()}>Search</button>
        </form>
      </div>

      {!query ? (
        <CategoryTabs value={cat} onChange={setCat} saved={bookmarks.length} />
      ) : (
        <div className="nw-query">
          <p><strong>Results for “{query}”</strong> <span className="muted">— headlines from many publishers via Google News</span></p>
          <button className="btn sm" type="button" onClick={() => (setQuery(""), setInput(""))}><X size={14} /> Clear search</button>
        </div>
      )}

      {!showSaved && error && (
        <div className="nw-note"><ErrorNote message={data ? `Couldn't refresh the news (${error}).` : `News is temporarily unavailable: ${error}`} onRetry={refresh} stale={stale} /></div>
      )}
      {!showSaved && !error && stale && data && (
        <div className="nw-note">
          <div className="notice" role="status">
            <Clock size={16} style={{ flex: "none", marginTop: 1 }} aria-hidden />
            <div className="grow">These headlines are a saved copy{updatedAt ? ` from ${timeAgo(updatedAt)}` : ""} and may be out of date.</div>
            <button type="button" className="btn sm" onClick={refresh} disabled={loading}><RefreshCw size={12} /> Refresh</button>
          </div>
        </div>
      )}

      <div className="nw-sheet" key={cat + "|" + query} {...(query ? { role: "region", "aria-label": "Search results" } : { role: "tabpanel", id: "nw-panel", "aria-labelledby": "nw-tab-" + cat })}>
        <div className="nw-edition">
          <div className="eyebrow">{today}</div>
          <div className="nw-edition-title">{label}{!firstLoad && source.length > 0 && <span className="nw-count">{f ? `${shown.length} of ${source.length}` : source.length} stor{source.length === 1 ? "y" : "ies"}</span>}</div>
          <div className="search nw-filter">
            <ListFilter size={15} aria-hidden />
            <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter these stories…" aria-label="Filter the stories shown" />
          </div>
        </div>

        {firstLoad && <FrontSkeleton />}

        {failed && (
          <div className="nw-empty">
            <Newspaper size={30} strokeWidth={1.5} aria-hidden />
            <strong>The headlines couldn't be loaded</strong>
            <p>The publisher feeds didn't answer. Check your connection, then try again.</p>
            <button type="button" className="btn primary" onClick={refresh}><RefreshCw size={14} /> Try again</button>
          </div>
        )}

        {(showSaved || (!loading && !error) || (!!data && !firstLoad)) && shown.length === 0 && !failed && (
          <div className="nw-empty">
            {showSaved ? <BookmarkIcon size={30} strokeWidth={1.5} aria-hidden /> : <Newspaper size={30} strokeWidth={1.5} aria-hidden />}
            <strong>{f ? "Nothing matches your filter" : showSaved ? "Nothing saved yet" : "No stories found"}</strong>
            <p>{f ? "Clear the filter to see every story." : showSaved ? "Use the bookmark on any story, or Save inside an article, to keep it here." : query ? "No headlines matched that search. Try different words." : "The feed returned no stories. Try another category."}</p>
            {f && <button type="button" className="btn" onClick={() => setFilter("")}><X size={14} /> Clear filter</button>}
          </div>
        )}

        {front && shown.length > 0 && <FrontPage items={shown} marks={marks} label={c.label} trending={cat === "trending"} />}
        {!front && shown.length > 0 && (
          <div className="nw-results">
            {shown.map((n, i) => <Story key={n.id} n={n} variant="result" marks={marks} eager={i < 2} />)}
          </div>
        )}
      </div>
    </div>
  );
}
