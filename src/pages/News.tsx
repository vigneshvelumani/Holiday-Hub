// News: discover by category or search, then read inside Holiday Hub.
// Feeds provide a headline, image, author, time and an excerpt (occasionally the
// full text). The reader shows all of that; the publisher's page is one click away
// for anything the feed does not carry. No article text is scraped.

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark as BookmarkIcon, BookmarkCheck, RefreshCw, Search, Share2 } from "lucide-react";
import { useNow } from "../lib/clock.ts";
import { toast } from "../lib/notify.ts";
import { NEWS_CATEGORIES, getArticle, newsCategory, newsSearchFeed, rememberArticles, useNews, type NewsItem } from "../lib/services.ts";
import { removeItem, saveItem, useData, type Bookmark } from "../lib/store.ts";
import { Empty, ErrorNote } from "../components/ui.tsx";
import { Thumb, timeAgo } from "./Dashboard.tsx";

const articleIdFromHash = () => location.hash.match(/^#\/news\/a\/([a-z0-9]+)/)?.[1] || null;
const catLabel = (id: string) => (id === "search" ? "Search result" : newsCategory(id)?.label || "News");
const fromBookmark = (b: Bookmark): NewsItem => ({ id: b.id, title: b.title, link: b.link, source: b.source, pubDate: b.pubDate, summary: b.summary, image: b.image, category: b.category || "saved", related: [] });

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

function Meta({ n, extra }: { n: NewsItem; extra?: string }) {
  return (
    <div className="meta">
      {n.source && <span className="src">{n.source}</span>}
      {n.pubDate && <time dateTime={new Date(n.pubDate).toISOString()}>{timeAgo(n.pubDate)}</time>}
      {n.tag && <span>{n.tag}</span>}
      {extra && <span>{extra}</span>}
    </div>
  );
}

// ── reader ───────────────────────────────────────────────────────────────────
function Reader({ id, pool }: { id: string; pool: NewsItem[] }) {
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
      <div className="page">
        <div className="reader-page">
          <button className="btn" onClick={() => (location.hash = "/news")}><ArrowLeft size={15} /> Back to news</button>
          <div className="card" style={{ marginTop: 20 }} role="alert">
            <Empty title="This article is no longer available">
              It has dropped out of the live feed and wasn't saved in this browser. Go back to the news list to see the latest stories.
            </Empty>
          </div>
        </div>
      </div>
    );
  }
  const share = async () => {
    const data = { title: n.title, text: `${n.title} — ${n.source}`, url: n.link };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(n.link);
        toast("Link copied", n.source, "ok");
      }
    } catch {
      /* cancelled or blocked */
    }
  };
  const words = (n.title + " " + n.summary).toLowerCase().match(/[a-z]{5,}/g) || [];
  const more = pool
    .filter((x) => x.id !== n.id)
    .map((x) => ({ x, score: words.filter((w) => x.title.toLowerCase().includes(w)).length + (x.category === n.category ? 0.5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.x);
  const body = n.content?.length ? n.content : n.summary ? [n.summary] : [];
  const full = !!n.content?.length;
  const savedNow = has(n.id);

  return (
    <div className="page">
      <div className="progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><i style={{ transform: `scaleX(${progress})` }} /></div>
      <article className="reader-page">
        <div className="reader-bar">
          <button className="btn" onClick={back}><ArrowLeft size={15} /> Back to news</button>
          <span className="grow" />
          <button className="btn" onClick={() => toggle(n)} aria-pressed={savedNow}>{savedNow ? <BookmarkCheck size={15} /> : <BookmarkIcon size={15} />} {savedNow ? "Saved" : "Save"}</button>
          <button className="btn" onClick={share}><Share2 size={15} /> Share</button>
        </div>
        <div className="eyebrow" style={{ color: "var(--today)" }}>{catLabel(n.category)}</div>
        <h1 style={{ margin: "8px 0 14px" }}>{n.title}</h1>
        <div className="meta" style={{ fontSize: 14, marginBottom: 20 }}>
          {n.author && <span>By <strong style={{ color: "var(--ink)" }}>{n.author}</strong></span>}
          <span className="src">{n.source}</span>
          {n.pubDate && <time dateTime={new Date(n.pubDate).toISOString()}>{new Date(n.pubDate).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" })} · {timeAgo(n.pubDate)}</time>}
        </div>
        {n.image && !imgBad && (
          <figure style={{ margin: "0 0 24px" }}>
            <img className="thumb" style={{ aspectRatio: "16 / 9" }} src={n.image} alt="" referrerPolicy="no-referrer" onError={() => setImgBad(true)} />
            <figcaption className="xs muted" style={{ marginTop: 6 }}>Image: {n.source}</figcaption>
          </figure>
        )}
        <div className="body">
          {body.length > 0 ? body.map((p, i) => <p key={i}>{p}</p>) : <p className="muted" style={{ fontFamily: "var(--font)", fontSize: 15 }}>The publisher's feed gives only the headline for this story.</p>}
        </div>
        <div className="notice" style={{ margin: "8px 0 28px" }}>
          <div className="grow">
            {full ? `Full text as provided by ${n.source}'s feed.` : `${n.source || "The publisher"} shares a summary in its feed, not the whole article, so that is what can be shown here. The complete story is on their site.`}
          </div>
          <a className="btn primary" href={n.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", flex: "none" }}>{full ? "View original" : "Read the full story"} <ArrowUpRight size={14} /><span className="sr"> at {n.source} (opens in a new tab)</span></a>
        </div>

        {n.related.length > 0 && (
          <section aria-labelledby="h-rel" style={{ marginBottom: 28 }}>
            <h2 id="h-rel" className="sec-title">Other publishers on this story</h2>
            <ul className="plain-list">
              {n.related.map((r) => (
                <li key={r.link}>
                  <a href={r.link} target="_blank" rel="noopener noreferrer" className="grow" style={{ textDecoration: "none" }}>
                    <span className="strong" style={{ display: "block", lineHeight: 1.4 }}>{r.title}</span>
                    <span className="xs muted">{r.source}<span className="sr"> (opens in a new tab)</span></span>
                  </a>
                  <ArrowUpRight size={14} className="muted" aria-hidden />
                </li>
              ))}
            </ul>
          </section>
        )}
        {more.length > 0 && (
          <section aria-labelledby="h-more">
            <h2 id="h-more" className="sec-title">Related articles</h2>
            <div className="stories">
              {more.map((x) => (
                <button key={x.id} className="story" onClick={() => (location.hash = "/news/a/" + x.id)}>
                  <Thumb n={x} />
                  <h3>{x.title}</h3>
                  <Meta n={x} />
                </button>
              ))}
            </div>
          </section>
        )}
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
  const { bookmarks } = useBookmarks();
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
  const lead = !f ? shown.find((n) => n.image && n.summary) || shown[0] : undefined;
  const rest = shown.filter((n) => n !== lead);
  const open = (n: NewsItem) => (location.hash = "/news/a/" + n.id);

  if (reading) return <Reader id={reading} pool={source} key={reading} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">News</h1>
          <p className="page-sub row wrap" style={{ gap: 8 }} role="status">
            {showSaved ? `${savedItems.length} saved article${savedItems.length === 1 ? "" : "s"}, kept in this browser` : <><span className="live-dot" /> Live from publisher feeds{updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ""} · refreshes by itself every 10 minutes</>}
          </p>
        </div>
        {!showSaved && <button className="btn" onClick={refresh} disabled={loading} title="Only needed if the headlines look out of date"><RefreshCw size={14} className={loading ? "spin" : ""} /> {loading ? "Updating…" : "Refresh now"}</button>}
      </div>

      <div>
        <form className="row wrap" style={{ marginBottom: 12 }} role="search" onSubmit={(e) => (e.preventDefault(), setQuery(input.trim()))}>
          <div className="search grow" style={{ maxWidth: 520 }}>
            <Search size={15} />
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search the news…" aria-label="Search all news" />
          </div>
          <button className="btn primary" type="submit" disabled={!input.trim()}>Search</button>
          {query && <button className="btn" type="button" onClick={() => (setQuery(""), setInput(""))}>Clear search</button>}
          <input className="input" style={{ width: 210 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter these stories…" aria-label="Filter the stories shown" />
        </form>
        {!query ? (
          <div className="tabs" role="tablist" aria-label="News categories">
            {NEWS_CATEGORIES.map((x) => (
              <button key={x.id} role="tab" aria-selected={cat === x.id} onClick={() => setCat(x.id)}>{x.label}</button>
            ))}
            <button role="tab" aria-selected={cat === "saved"} onClick={() => setCat("saved")}><BookmarkIcon size={13} style={{ verticalAlign: "-2px" }} /> Saved ({bookmarks.length})</button>
          </div>
        ) : (
          <p className="small muted">Results for “{query}” — headlines from many publishers via Google News</p>
        )}
      </div>

      {!showSaved && error && <div style={{ margin: "14px 0" }}><ErrorNote message={data ? `Couldn't refresh the news (${error}).` : `News is temporarily unavailable: ${error}`} onRetry={refresh} stale={stale} /></div>}

      <div style={{ marginTop: 22 }} key={cat + query}>
        {!showSaved && loading && !data && (
          <div className="stories" aria-busy="true" aria-label="Loading stories">{Array.from({ length: 6 }, (_, i) => <div key={i} className="stack tight"><div className="skeleton" style={{ aspectRatio: "16 / 10" }} /><div className="skeleton" style={{ height: 18 }} /><div className="skeleton" style={{ height: 14, width: "60%" }} /></div>)}</div>
        )}
        {(showSaved || (!loading && !error)) && shown.length === 0 && (
          <div className="card"><Empty title={showSaved ? "Nothing saved yet" : f ? "Nothing matches your filter" : "No stories found"}>{showSaved ? "Open any article and choose Save to keep it here." : f ? "Clear the filter to see every story." : "The feed returned no stories. Try another category."}</Empty></div>
        )}
        {lead && (
          <button className="lead" onClick={() => open(lead)} style={{ marginBottom: 34 }}>
            <Thumb n={lead} eager />
            <div>
              <div className="eyebrow" style={{ color: "var(--today)", marginBottom: 8 }}>{showSaved ? "Most recently saved" : cat === "trending" ? "Most covered right now" : "Featured"}</div>
              <h2>{lead.title}</h2>
              {lead.summary && <p style={{ margin: "10px 0", color: "var(--ink-2)", fontSize: 16 }}>{lead.summary.slice(0, 260)}{lead.summary.length > 260 ? "…" : ""}</p>}
              <Meta n={lead} extra={lead.related.length ? `covered by ${lead.related.length + 1} publishers` : undefined} />
            </div>
          </button>
        )}
        {rest.length > 0 && (
          <>
            <div className="sec-head"><h2>{showSaved ? "Saved" : query ? "Results" : cat === "trending" ? "Trending" : "Latest"}</h2><span className="small muted">{rest.length} stor{rest.length === 1 ? "y" : "ies"}</span></div>
            <div className="stories stagger">
              {rest.map((n) => (
                <button key={n.id} className="story" onClick={() => open(n)}>
                  <Thumb n={n} />
                  <h3>{n.title}</h3>
                  {n.summary && <p>{n.summary}</p>}
                  <Meta n={n} extra={n.related.length ? `+${n.related.length} publishers` : undefined} />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
