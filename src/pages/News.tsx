import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { useNow } from "../lib/clock.ts";
import { NEWS_CATEGORIES, newsSearchFeed, useNews, type NewsItem } from "../lib/services.ts";
import { Empty, ErrorNote, Modal } from "../components/ui.tsx";
import { timeAgo } from "./Dashboard.tsx";

function useWide(query: string): boolean {
  const [ok, setOk] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setOk(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return ok;
}

function Reader({ n }: { n: NewsItem }) {
  return (
    <article className="stack" key={n.link}>
      <div className="row wrap small muted">
        {n.tag && <span className="badge">{n.tag}</span>}
        {n.source && <span className="strong" style={{ color: "var(--ink)" }}>{n.source}</span>}
        {n.pubDate && <span>{new Date(n.pubDate).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {timeAgo(n.pubDate)}</span>}
      </div>
      <h2>{n.title}</h2>
      {n.summary && <p style={{ fontSize: 15, lineHeight: 1.6 }}>{n.summary}</p>}
      {n.related.length > 0 && (
        <div>
          <div className="sec-title">How others are reporting it</div>
          <div className="list anim" style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
            {n.related.map((r) => (
              <a key={r.link} className="list-row click" href={r.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", alignItems: "center" }}>
                <span className="grow"><span className="strong" style={{ display: "block", lineHeight: 1.4 }}>{r.title}</span><span className="xs muted">{r.source}</span></span>
                <ArrowUpRight size={14} className="muted" style={{ flex: "none" }} />
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="row wrap">
        <a className="btn primary" href={n.link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Continue reading at {n.source || "the publisher"} <ArrowUpRight size={14} /></a>
      </div>
      <p className="xs muted">News sites don't allow their full articles to be displayed inside another website, so the headline, summary and related coverage are shown here and the complete story opens at the publisher.</p>
    </article>
  );
}

export function NewsPage() {
  useNow(60000); // keeps "updated … ago" current
  const wide = useWide("(min-width: 1241px)");
  const [cat, setCat] = useState("india");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const c = NEWS_CATEGORIES.find((x) => x.id === cat)!;
  const { data, loading, error, stale, refresh, updatedAt } = useNews(query ? "search:" + query : c.id, query ? newsSearchFeed(query) : c.feed);
  const f = filter.trim().toLowerCase();
  const shown = (data || []).filter((n) => !f || (n.title + " " + n.source + " " + n.summary).toLowerCase().includes(f));
  const current = shown.find((n) => n.link === sel) || (wide ? shown[0] : undefined);
  useEffect(() => setSel(null), [cat, query]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">News</h1>
          <p className="page-sub row wrap" style={{ gap: 8 }}>
            <span className="live-dot" /> Live headlines{updatedAt ? ` · updated ${timeAgo(updatedAt)}` : ""} · refreshes by itself every 10 minutes
          </p>
        </div>
        <button className="btn" onClick={refresh} disabled={loading} title="Only needed if the headlines look out of date"><RefreshCw size={14} className={loading ? "spin" : ""} /> {loading ? "Updating…" : "Refresh now"}</button>
      </div>

      <div>
        <form className="row wrap" style={{ marginBottom: 12 }} onSubmit={(e) => (e.preventDefault(), setQuery(input.trim()))}>
          <div className="search grow" style={{ maxWidth: 520 }}>
            <Search size={15} />
            <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search the news…" aria-label="Search news" />
          </div>
          <button className="btn primary" type="submit" disabled={!input.trim()}>Search</button>
          {query && <button className="btn" type="button" onClick={() => (setQuery(""), setInput(""))}>Clear search</button>}
          <input className="input" style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter these headlines…" aria-label="Filter loaded headlines" />
        </form>
        {!query ? (
          <div className="tabs" role="tablist" aria-label="News categories">
            {NEWS_CATEGORIES.map((x) => (
              <button key={x.id} role="tab" aria-selected={cat === x.id} onClick={() => setCat(x.id)}>{x.label}</button>
            ))}
          </div>
        ) : (
          <p className="small muted">Results for “{query}”</p>
        )}
      </div>

      {error && <div style={{ margin: "12px 0" }}><ErrorNote message={`News couldn't be updated: ${error}`} onRetry={refresh} stale={stale} /></div>}

      <div className="news-split" style={{ marginTop: 14 }}>
        <div className="card news-list" key={cat + query}>
          {loading && !data && <div className="card-pad stack">{Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton" style={{ height: 46 }} />)}</div>}
          {!loading && !error && shown.length === 0 && <Empty title="No headlines found">{f ? "Nothing matches your filter." : "The feed returned no stories. Try another category."}</Empty>}
          <div className="list anim">
            {shown.map((n) => (
              <button key={n.link} className={"news-row" + (current?.link === n.link ? " sel" : "")} onClick={() => (setSel(n.link), setOpen(true))} aria-current={current?.link === n.link}>
                <h3>{n.title}</h3>
                <div className="xs muted" style={{ marginTop: 4 }}>{[n.tag, n.source, n.pubDate ? timeAgo(n.pubDate) : "", n.related.length ? `+${n.related.length} sources` : ""].filter(Boolean).join(" · ")}</div>
              </button>
            ))}
          </div>
        </div>
        {wide && (
          <div className="card card-pad reader">
            {current ? <Reader n={current} /> : <Empty title="Select a headline">Its summary and related coverage will appear here.</Empty>}
          </div>
        )}
      </div>
      {!wide && open && current && (
        <Modal title={current.source || "Story"} onClose={() => setOpen(false)} wide>
          <div className="reader" style={{ position: "static", maxHeight: "none" }}><Reader n={current} /></div>
        </Modal>
      )}
    </div>
  );
}
