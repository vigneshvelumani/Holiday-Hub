// Location control: detect (with permission handling and a sanity check against the
// device clock), search by country + city, and show exactly what is in use.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import type { Place } from "../lib/astro.ts";
import { LOCAL_TZ, fmtZone, fmtZoneDate, tzLabel, tzName, useNow } from "../lib/clock.ts";
import { GeoError, clockMismatch, countries, detectPlace, placeCity, placeRest, searchPlaces, setActiveLocation } from "../lib/location.ts";
import { toast } from "../lib/notify.ts";
import { updateSettings, useSettings } from "../lib/store.ts";
import { Modal } from "./ui.tsx";

type Phase = { kind: "idle" } | { kind: "detecting" } | { kind: "confirm"; place: Place } | { kind: "error"; message: string; denied: boolean };

const ago = (t: number | null) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export function LocationDialog({ welcome, onClose }: { welcome?: boolean; onClose: () => void }) {
  const s = useSettings();
  const now = useNow(60000);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [country, setCountry] = useState(s.location.countryCode || "");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const started = useRef(false);

  const close = () => {
    if (!s.locationPrompted) updateSettings({ locationPrompted: true });
    onClose();
  };
  const use = (p: Place, source: "gps" | "manual") => {
    setActiveLocation(p, source);
    toast("Location set", `${p.name} · ${tzName(p.tz)}`, "ok");
    onClose();
  };
  const detect = async () => {
    setPhase({ kind: "detecting" });
    try {
      const p = await detectPlace();
      // a detected place in another time zone than the device clock is confirmed, never trusted silently
      if (clockMismatch(p)) setPhase({ kind: "confirm", place: p });
      else use(p, "gps");
    } catch (e) {
      const ge = e as GeoError;
      setPhase({ kind: "error", message: ge.message || "Your location couldn't be determined.", denied: ge.kind === "denied" });
    }
  };
  useEffect(() => {
    if (welcome && !started.current) {
      started.current = true;
      void detect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const find = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setSearchErr("");
    try {
      setResults(await searchPlaces(q.trim(), country || undefined));
    } catch (err) {
      setResults(null);
      setSearchErr((err as Error).message || "City search failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const loc = s.location;
  return (
    <Modal title={welcome ? "Where are you?" : "Location"} onClose={close} wide>
      {welcome && phase.kind !== "confirm" && (
        <p className="muted">Holiday Hub uses one location for weather, local time, sunrise and sunset, and the Panchangam. Allow location access when your browser asks, or choose a city below.</p>
      )}

      {phase.kind === "confirm" ? (
        <div className="notice" role="alertdialog" aria-label="Confirm detected location" style={{ flexDirection: "column", gap: 12 }}>
          <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
            <AlertTriangle size={18} style={{ flex: "none", marginTop: 2, color: "var(--c-reminder)" }} />
            <div>
              <div className="strong" style={{ fontSize: 15 }}>Is {phase.place.name} really where you are?</div>
              <p className="small" style={{ marginTop: 4 }}>
                Your browser reported <strong>{phase.place.name}</strong> ({tzLabel(phase.place.tz)}), but this device's clock is set to <strong>{tzName(LOCAL_TZ)}</strong>. Computers without GPS estimate location from the network, and a VPN or your internet provider's routing can put that far from where you actually are.
              </p>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn primary" onClick={() => setPhase({ kind: "idle" })} data-autofocus>No — let me choose my city</button>
            <button className="btn" onClick={() => use(phase.place, "gps")}>Yes, use {placeCity(phase.place)}</button>
          </div>
        </div>
      ) : (
        <>
          <section aria-label="Location in use" className="loc-current">
            <MapPin size={20} style={{ flex: "none", marginTop: 3 }} />
            <div className="grow">
              <div className="display" style={{ fontSize: 22, lineHeight: 1.15 }}>{placeCity(loc)}</div>
              <div className="muted">{placeRest(loc)}</div>
              <dl className="kv small" style={{ marginTop: 10, maxWidth: 440 }}>
                <dt>Time zone</dt><dd>{tzLabel(loc.tz, now)}</dd>
                <dt>Local time there</dt><dd className="num">{fmtZoneDate(now, loc.tz)}, {fmtZone(now, loc.tz, s.hour12)}</dd>
                <dt>Chosen by</dt><dd>{s.locationSource === "gps" ? "Detected from this device" : s.locationSource === "manual" ? "Picked by you" : "Starting default — not yet chosen"}</dd>
                <dt>Last updated</dt><dd>{ago(s.locationUpdatedAt)}</dd>
              </dl>
            </div>
          </section>

          <div className="row wrap">
            <button className="btn primary" onClick={detect} disabled={phase.kind === "detecting"}>
              {phase.kind === "detecting" ? <Loader2 size={15} className="spin" /> : <LocateFixed size={15} />} {phase.kind === "detecting" ? "Finding your location…" : s.locationSource === "gps" ? "Detect again" : "Use my current location"}
            </button>
            {phase.kind === "detecting" && <span className="small muted" role="status">Waiting for your browser — answer its permission question if one appears.</span>}
          </div>
          {phase.kind === "error" && (
            <div className="notice err" role="alert">
              <AlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
              <div>
                {phase.message}
                {phase.denied && <div className="small muted" style={{ marginTop: 4 }}>To allow it later, open the site permissions from the padlock icon in your browser's address bar.</div>}
              </div>
            </div>
          )}

          <section aria-labelledby="loc-search-h" className="stack tight">
            <h3 id="loc-search-h" className="sec-title" style={{ marginBottom: 0 }}>Choose a city</h3>
            <form className="loc-form" onSubmit={find}>
              <label className="field">
                <span className="label">Country</span>
                <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="">Any country</option>
                  {countries().map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="label">City, town or area</span>
                <div className="search" style={{ maxWidth: "none" }}>
                  <Search size={15} />
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Coimbatore" data-autofocus={!welcome || undefined} />
                </div>
              </label>
              <button className="btn" type="submit" disabled={busy || q.trim().length < 2}>{busy ? <Loader2 size={14} className="spin" /> : "Search"}</button>
            </form>
            {searchErr && <div className="notice err" role="alert">{searchErr}</div>}
            {results && (
              <div className="card list anim" role="listbox" aria-label="Matching places">
                {results.length === 0 && <div className="empty"><strong>No places found</strong>Check the spelling, try a nearby city, or change the country.</div>}
                {results.map((p) => {
                  const active = p.lat === loc.lat && p.lon === loc.lon;
                  return (
                    <button key={p.name + p.lat + p.lon} role="option" aria-selected={active} className="list-row click" style={{ border: 0, background: "none", width: "100%", textAlign: "left", alignItems: "center" }} onClick={() => use(p, "manual")}>
                      <MapPin size={15} />
                      <span className="grow"><span className="strong" style={{ display: "block" }}>{p.name}</span><span className="small muted">{tzLabel(p.tz, now)} · now {fmtZone(now, p.tz, s.hour12)}</span></span>
                      {active && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
          <p className="xs muted">Your location is stored only in this browser and is sent only to the weather and place-name services (Open-Meteo, BigDataCloud) as coordinates.</p>
        </>
      )}
    </Modal>
  );
}

/** Small button showing the active place; opens the dialog. */
export function LocationChip({ onOpen, light }: { onOpen: () => void; light?: boolean }) {
  const s = useSettings();
  return (
    <button className={"loc-chip" + (light ? " light" : "")} onClick={onOpen} aria-label={`Location: ${s.location.name}. Change location`} title="Change location">
      <MapPin size={14} />
      <span className="truncate">{placeCity(s.location)}{placeRest(s.location) ? <span className="rest">, {placeRest(s.location)}</span> : null}</span>
    </button>
  );
}
