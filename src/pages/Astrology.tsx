import "./astrology.css";
import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Moon, Sunrise, Sunset } from "lucide-react";
import { addDays, fmt, fmtLong, isValidYmd, parseYmd, relDays, today, ymd, WEEKDAYS } from "../lib/dates.ts";
import { fmtInZone, lunarObservances, moonEvents, panchangam, planetPositions } from "../lib/astro.ts";
import { useNow } from "../lib/clock.ts";
import { holidaysForYear, regionsOf } from "../lib/holidays.ts";
import { ZODIAC, ZODIAC_DATES, useHoroscope } from "../lib/services.ts";
import { updateSettings, useSettings } from "../lib/store.ts";
import { ErrorNote, MoonDisc, useUi } from "../components/ui.tsx";
import { GRAHA_SHORT, LunarCycle, ZodiacWheel } from "../components/Celestial.tsx";
import { LocationChip } from "../components/Location.tsx";

const VARA = ["Ravivara", "Somavara", "Mangalavara", "Budhavara", "Guruvara", "Shukravara", "Shanivara"];
const VARA_LORD = ["the Sun (Surya)", "the Moon (Chandra)", "Mars (Mangala)", "Mercury (Budha)", "Jupiter (Guru)", "Venus (Shukra)", "Saturn (Shani)"];
const ORD = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const PERIODS = [
  { key: "rahuKalam", label: "Rahu Kalam", short: "Rahu", code: "R", cls: "rahu", note: "Traditionally avoided for new beginnings" },
  { key: "yamagandam", label: "Yamagandam", short: "Yama", code: "Y", cls: "yama", note: "Traditionally avoided for important work" },
  { key: "kuligai", label: "Kuligai", short: "Kuligai", code: "K", cls: "kuli", note: "Traditionally avoided for one-off events" },
  { key: "abhijit", label: "Abhijit", short: "Abhijit", code: "A", cls: "abhi", note: "The midday muhurta, considered favourable" },
] as const;
const PHASE_ELONGATION = { "New Moon": 0, "First Quarter": 90, "Full Moon": 180, "Last Quarter": 270 } as const;

/** Whole clock hours (in the place's time zone) between two instants. */
function hourTicks(from: Date, to: Date, tz: string): { at: Date; hour: number }[] {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" });
    const o: Record<string, number> = {};
    for (const p of f.formatToParts(from)) if (p.type !== "literal") o[p.type] = Number(p.value);
    const past = (o.minute * 60 + o.second) * 1000;
    let t = from.getTime() - past + (past ? 3600000 : 0);
    let h = (o.hour + (past ? 1 : 0)) % 24;
    const out: { at: Date; hour: number }[] = [];
    for (; t <= to.getTime() && out.length < 30; t += 3600000, h = (h + 1) % 24) out.push({ at: new Date(t), hour: h });
    return out;
  } catch {
    return [];
  }
}

export function AstrologyPage() {
  const ui = useUi();
  const s = useSettings();
  const now = useNow(60000);
  const [date, setDate] = useState(ymd(today()));
  const tz = s.location.tz;
  const t = (d: Date | null | undefined, day = false) => fmtInZone(d, tz, s.hour12, day);
  const span = (r: [Date, Date] | null) => (r ? `${t(r[0])} – ${t(r[1])}` : "—");
  const calc = useMemo(() => {
    try {
      const p = panchangam(date, s.location);
      const ref = p.sunrise ?? parseYmd(date);
      return { p, planets: planetPositions(ref), moons: moonEvents(ref, 8), obs: lunarObservances(date, 45, s.location), error: "" };
    } catch (e) {
      return { p: null, planets: [], moons: [], obs: [], error: (e as Error).message };
    }
  }, [date, s.location]);
  const festivals = useMemo(() => {
    const y = Number(date.slice(0, 4));
    return [...holidaysForYear(y), ...holidaysForYear(y + 1)].filter((h) => h.date >= date && (h.kind === "festival" || (h.kind === "public" && !!h.note))).slice(0, 14);
  }, [date]);
  const h = useHoroscope(s.zodiac, ymd(today()));
  const { p } = calc;
  const d = parseYmd(date);
  const isToday = date === ymd(today());
  const place = s.location.name.split(",")[0];
  const dayLen = p?.sunrise && p.sunset ? p.sunset.getTime() - p.sunrise.getTime() : 0;
  const pct = (x: Date) => (p?.sunrise && dayLen > 0 ? ((x.getTime() - p.sunrise.getTime()) / dayLen) * 100 : 0);
  const nowPct = pct(now);
  const nowInDay = isToday && dayLen > 0 && nowPct >= 0 && nowPct <= 100;
  const dur = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  const until = (x: Date) => {
    const ms = x.getTime() - now.getTime();
    if (ms <= 0) return isToday ? "already ended today" : "";
    return ms < 36 * 3600000 ? `${dur(ms)} left` : "";
  };
  const periodState = (r: [Date, Date] | null) => {
    if (!isToday || !r) return "";
    if (now < r[0]) return `starts in ${dur(r[0].getTime() - now.getTime())}`;
    if (now < r[1]) return `in progress · ${dur(r[1].getTime() - now.getTime())} left`;
    return "ended";
  };
  const ticks = useMemo(() => (p?.sunrise && p.sunset ? hourTicks(p.sunrise, p.sunset, tz) : []), [p, tz]);
  const hourLabel = (hh: number) => (s.hour12 ? `${hh % 12 || 12} ${hh < 12 ? "am" : "pm"}` : `${String(hh).padStart(2, "0")}:00`);
  const nextNew = calc.moons.find((m) => m.name === "New Moon");
  const nextFull = calc.moons.find((m) => m.name === "Full Moon");
  const waxing = p?.tithi.paksha === "Shukla";

  return (
    <div className="page as-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Astrology &amp; Panchangam</h1>
          <p className="page-sub">An almanac calculated for {place}: the Moon, the five limbs of the day, its traditional timings and the planets.</p>
        </div>
      </div>
      {calc.error && <ErrorNote message={`Panchangam couldn't be calculated for this date and place: ${calc.error}`} />}

      {/* ── hero: the Moon on the selected date ── */}
      <section className="as-hero" aria-label="Moon and tithi for the selected date">
        <div className="as-hero-bar">
          <div className="as-datenav" role="group" aria-label="Choose a date">
            <button type="button" className="as-hbtn" aria-label="Previous day" title="Previous day" onClick={() => setDate(ymd(addDays(d, -1)))}><ChevronLeft size={18} /></button>
            <input className="as-date" type="date" value={date} onChange={(e) => isValidYmd(e.target.value) && setDate(e.target.value)} aria-label="Date" />
            <button type="button" className="as-hbtn" aria-label="Next day" title="Next day" onClick={() => setDate(ymd(addDays(d, 1)))}><ChevronRight size={18} /></button>
            <button type="button" className="as-hbtn text" onClick={() => setDate(ymd(today()))} disabled={isToday} aria-label={isToday ? "Today (showing today)" : "Go to today"}>Today</button>
          </div>
          <LocationChip light onOpen={ui.openLocation} />
        </div>

        {p ? (
          <div className="as-hero-main">
            <div className="as-hero-moon"><MoonDisc elongation={p.moon.elongation} size={176} dark /></div>
            <div className="as-hero-text">
              <p className="as-hero-date">{fmtLong(d)} <span>· {relDays(d)}</span></p>
              <h2 className="as-hero-phase">{p.moon.phaseName}</h2>
              <p className="as-hero-lit"><span className="num">{(p.moon.illumination * 100).toFixed(0)}%</span> illuminated · {waxing ? "waxing" : "waning"}</p>
              <dl className="as-hero-facts">
                <div>
                  <dt>Tithi <span>lunar day</span></dt>
                  <dd>{p.tithi.name}<small>{p.tithi.paksha} Paksha · the {waxing ? "bright, waxing" : "dark, waning"} fortnight</small></dd>
                </div>
                <div>
                  <dt>Nakshatra <span>lunar mansion</span></dt>
                  <dd>{p.nakshatra.name}<small>{p.nakshatra.tamil} in Tamil</small></dd>
                </div>
              </dl>
            </div>
            <dl className="as-hero-next" aria-label="Next new and full moon">
              <div>
                <dt><MoonDisc elongation={0} size={22} dark /> Next new moon</dt>
                <dd className="num">{nextNew ? t(nextNew.at, true) : "—"}</dd>
                {nextNew && <dd className="sub">{relDays(new Date(nextNew.at))} · Amavasya</dd>}
              </div>
              <div>
                <dt><MoonDisc elongation={180} size={22} dark /> Next full moon</dt>
                <dd className="num">{nextFull ? t(nextFull.at, true) : "—"}</dd>
                {nextFull && <dd className="sub">{relDays(new Date(nextFull.at))} · Purnima</dd>}
              </div>
            </dl>
          </div>
        ) : (
          <p className="as-hero-empty">The Moon's phase and the day's limbs couldn't be calculated for this date and place.</p>
        )}
      </section>

      {p && (
        <div className="as-grid two">
          {/* ── the five limbs ── */}
          <section className="panel" aria-labelledby="h-limbs">
            <div className="panel-head">
              <h2 id="h-limbs">The five limbs</h2>
              <span className="as-head-note">Pancha-anga · as at sunrise{p.sunrise ? `, ${t(p.sunrise)}` : ""}</span>
            </div>
            <ol className="as-limbs">
              <li>
                <div className="term">Tithi<span>lunar day</span></div>
                <div className="val">{p.tithi.paksha} {p.tithi.name}<span>{ORD(p.tithi.number)} of 15 in the {waxing ? "waxing" : "waning"} fortnight</span></div>
                <div className="end"><span className="num">until {t(p.tithi.endsAt, true)}</span>{until(p.tithi.endsAt) && <span className="left num">{until(p.tithi.endsAt)}</span>}</div>
                <p className="mean">One of thirty lunar days: each lasts while the Moon gains 12° on the Sun.</p>
              </li>
              <li>
                <div className="term">Nakshatra<span>lunar mansion</span></div>
                <div className="val">{p.nakshatra.name}<span>{p.nakshatra.tamil} in Tamil</span></div>
                <div className="end"><span className="num">until {t(p.nakshatra.endsAt, true)}</span>{until(p.nakshatra.endsAt) && <span className="left num">{until(p.nakshatra.endsAt)}</span>}</div>
                <p className="mean">Which of the 27 star-segments of the sky (13°20′ each) the Moon is passing through.</p>
              </li>
              <li>
                <div className="term">Yoga<span>Sun–Moon sum</span></div>
                <div className="val">{p.yoga.name}</div>
                <div className="end"><span className="num">until {t(p.yoga.endsAt, true)}</span>{until(p.yoga.endsAt) && <span className="left num">{until(p.yoga.endsAt)}</span>}</div>
                <p className="mean">One of 27 divisions of the Sun's and Moon's longitudes added together.</p>
              </li>
              <li>
                <div className="term">Karana<span>half a tithi</span></div>
                <div className="val">{p.karana.name}</div>
                <div className="end"><span className="num">until {t(p.karana.endsAt, true)}</span>{until(p.karana.endsAt) && <span className="left num">{until(p.karana.endsAt)}</span>}</div>
                <p className="mean">Half of a lunar day: it lasts while the Moon gains 6° on the Sun.</p>
              </li>
              <li>
                <div className="term">Vara<span>weekday</span></div>
                <div className="val">{VARA[p.weekday]}<span>{WEEKDAYS[p.weekday]}</span></div>
                <div className="end"><span>sunrise to sunrise</span></div>
                <p className="mean">The weekday, named for {VARA_LORD[p.weekday]}; in the almanac it runs from one sunrise to the next.</p>
              </li>
            </ol>
          </section>

          {/* ── calendar reckoning ── */}
          <section className="panel" aria-labelledby="h-reckon">
            <div className="panel-head">
              <h2 id="h-reckon">Calendar &amp; signs</h2>
              <span className="as-head-note">sidereal zodiac · Lahiri ayanamsa</span>
            </div>
            <dl className="as-reckon">
              <div>
                <dt>Tamil date<span>solar month</span></dt>
                <dd>{p.tamilMonth}{p.tamilDay ? <> <span className="num">{p.tamilDay}</span></> : ""}</dd>
                <dd className="sub">The Tamil month begins when the Sun enters a new sign.{p.tamilDay ? "" : " The day of the month couldn't be calculated for this date."}</dd>
              </div>
              <div>
                <dt>Lunar month<span>amanta reckoning</span></dt>
                <dd>{p.lunarMonth}</dd>
                <dd className="sub">Counted from new moon to new moon.</dd>
              </div>
              <div>
                <dt>Sun sign<span>Surya rashi</span></dt>
                <dd>{p.sunRashi.split(" ")[0]} <small>{p.sunRashi.split(" ").slice(1).join(" ")}</small></dd>
                <dd className="sub">The sidereal sign the Sun is in at sunrise.</dd>
              </div>
              <div>
                <dt>Moon sign<span>Chandra rashi</span></dt>
                <dd>{p.moonRashi.split(" ")[0]} <small>{p.moonRashi.split(" ").slice(1).join(" ")}</small></dd>
                <dd className="sub">The sidereal sign the Moon is in at sunrise.</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {/* ── the day's timings ── */}
      {p && (
        <section className="panel as-gap" aria-labelledby="h-timings">
          <div className="panel-head">
            <h2 id="h-timings">The day's timings</h2>
            <span className="as-head-note">sunrise to sunset, divided the traditional way · times for {place}</span>
          </div>
          <dl className="as-sun">
            <div><dt><Sunrise size={16} aria-hidden /> Sunrise</dt><dd className="num">{t(p.sunrise)}</dd></div>
            <div><dt><Sunset size={16} aria-hidden /> Sunset</dt><dd className="num">{t(p.sunset)}</dd></div>
            <div><dt><Moon size={16} aria-hidden /> Moonrise</dt><dd className="num">{t(p.moonrise)}</dd></div>
            <div><dt><Moon size={16} aria-hidden /> Moonset</dt><dd className="num">{t(p.moonset)}</dd></div>
          </dl>
          {p.sunrise && p.sunset && dayLen > 0 ? (
            <div className="as-timings">
              <div className="as-tl">
                <div className="as-tl-plot" role="img" aria-label={`Daytime from ${t(p.sunrise)} to ${t(p.sunset)}. ${PERIODS.map((x) => `${x.label} ${span(p[x.key])}`).join(", ")}.${nowInDay ? ` Now ${t(now)}.` : ""}`}>
                  <div className="as-tl-track">
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => <span key={n} className="as-tl-div" style={{ left: `${n * 12.5}%` }} />)}
                    {PERIODS.filter((x) => x.key !== "abhijit").map((x) => {
                      const r = p[x.key];
                      return r && (
                        <div key={x.key} className={`as-band ${x.cls}`} style={{ left: `${pct(r[0])}%`, width: `${pct(r[1]) - pct(r[0])}%` }} title={`${x.label}: ${span(r)}`}>
                          <span className="l-full">{x.label}</span><span className="l-short">{x.short}</span><span className="l-code">{x.code}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="as-tl-fav">
                    {p.abhijit && (
                      <div className="as-fav" style={{ left: `${pct(p.abhijit[0])}%`, width: `${pct(p.abhijit[1]) - pct(p.abhijit[0])}%` }} title={`Abhijit: ${span(p.abhijit)}`}>
                        <span className="as-band abhi" />
                        <span className="as-fav-label">Abhijit · favourable</span>
                      </div>
                    )}
                  </div>
                  <div className="as-tl-axis">
                    {ticks.map((k) => (
                      <span key={k.at.getTime()} className={"as-tick" + (k.hour % 3 === 0 ? " major" : "")} style={{ left: `${pct(k.at)}%` }}>
                        {k.hour % 3 === 0 && <span className="num">{hourLabel(k.hour)}</span>}
                      </span>
                    ))}
                  </div>
                  {nowInDay && <div className="as-now" style={{ left: `${nowPct}%` }}><span className="num">Now {t(now)}</span></div>}
                </div>
                <div className="as-tl-ends num">
                  <span>Sunrise {t(p.sunrise)}</span>
                  <span>Sunset {t(p.sunset)}</span>
                </div>
                {isToday && !nowInDay && <p className="as-tl-note">{nowPct < 0 ? "It is before sunrise — the day's periods haven't started." : "The Sun has set — the day's periods are over."}</p>}
              </div>
              <ul className="as-periods" aria-label="Exact times">
                {PERIODS.map((x) => (
                  <li key={x.key}>
                    <span className={`as-swatch as-band ${x.cls}`} aria-hidden>{x.code}</span>
                    <span className="name">{x.label}<small>{x.note}</small></span>
                    <span className="time num">{span(p[x.key])}{periodState(p[x.key]) && <small>{periodState(p[x.key])}</small>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="note-state">The Sun doesn't rise and set on this date at this location, so the daytime can't be divided into Rahu Kalam, Yamagandam, Kuligai and Abhijit.</p>
          )}
        </section>
      )}

      {/* ── lunar month ── */}
      {p && (
        <section className="panel as-gap" aria-labelledby="h-cycle">
          <div className="panel-head">
            <h2 id="h-cycle">This lunar month</h2>
            <span className="as-head-note">{p.lunarMonth} · new moon to new moon · select a day</span>
          </div>
          <LunarCycle dateKey={date} place={s.location} onPick={setDate} />
          {calc.moons.length > 0 && (
            <>
              <h3 className="as-sub">Upcoming phases</h3>
              <ul className="as-phases">
                {calc.moons.map((m) => (
                  <li key={m.at.toISOString()}>
                    <button type="button" onClick={() => ui.openDay(new Date(m.at))} title="Open this day">
                      <MoonDisc elongation={PHASE_ELONGATION[m.name]} size={34} />
                      <span>
                        <span className="n">{m.name}</span>
                        <span className="w num">{t(m.at, true)}</span>
                        <span className="r">{relDays(new Date(m.at))}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* ── planetary positions ── */}
      {calc.planets.length > 0 && (
        <section className="panel as-gap" aria-labelledby="h-planets">
          <div className="panel-head">
            <h2 id="h-planets">Planetary positions</h2>
            <span className="as-head-note">the nine grahas in the sidereal zodiac · at {p?.sunrise ? `sunrise, ${t(p.sunrise)}` : "the start of the day"}</span>
          </div>
          <div className="as-planets">
            <figure className="as-wheel-fig">
              <ZodiacWheel planets={calc.planets} />
              <figcaption>0° Mesha is at the left; the signs run clockwise. Shaded signs are occupied. “R” marks a retrograde planet.</figcaption>
            </figure>
            <div className="as-table-wrap" tabIndex={0} role="region" aria-label="Planetary positions table">
              <table className="as-table">
                <thead><tr><th scope="col">Graha</th><th scope="col">Rashi</th><th scope="col" className="r">Degree</th><th scope="col">Nakshatra</th><th scope="col">Motion</th></tr></thead>
                <tbody>
                  {calc.planets.map((pl) => {
                    const [name, ...rest] = pl.name.split(" ");
                    const [rashi, ...en] = pl.rashi.split(" ");
                    return (
                      <tr key={pl.name}>
                        <th scope="row"><span className="abbr" aria-hidden>{GRAHA_SHORT[name] || name.slice(0, 2)}</span><span>{name}<small>{rest.join(" ").replace(/[()]/g, "")}</small></span></th>
                        <td>{rashi}<small>{en.join(" ").replace(/[()]/g, "")}</small></td>
                        <td className="num r">{Math.floor(pl.degreeInSign)}° {String(Math.floor((pl.degreeInSign % 1) * 60)).padStart(2, "0")}′</td>
                        <td>{pl.nakshatra || "—"}</td>
                        <td>{pl.retrograde ? <span className="retro">Retrograde</span> : "Direct"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ── observances and festivals ── */}
      <div className="as-grid two as-gap">
        <section className="panel" aria-labelledby="h-obs">
          <div className="panel-head"><h2 id="h-obs">Auspicious &amp; observance days</h2><span className="as-head-note">next 45 days · by the tithi at sunrise</span></div>
          {calc.obs.length === 0 ? <p className="note-state">None in this period.</p> : (
            <ul className="as-list">
              {calc.obs.map((o) => (
                <li key={o.dateKey + o.name}>
                  <button type="button" onClick={() => ui.openDay(parseYmd(o.dateKey))}>
                    <span className="d"><span className="num">{fmt(parseYmd(o.dateKey), { day: "numeric", month: "short" })}</span><small>{fmt(parseYmd(o.dateKey), { weekday: "short" })}</small></span>
                    <span className="b"><span className="t">{o.name}</span><small>{o.detail}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel" aria-labelledby="h-fest">
          <div className="panel-head"><h2 id="h-fest">Festival dates</h2><span className="as-head-note">calculated for each year</span></div>
          {festivals.length === 0 ? <p className="note-state">No festival dates found after this date.</p> : (
            <ul className="as-list">
              {festivals.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => ui.openDay(parseYmd(f.date))}>
                    <span className="d"><span className="num">{fmt(parseYmd(f.date), { day: "numeric", month: "short" })}</span><small className="num">{f.date.slice(0, 4)}</small></span>
                    <span className="b"><span className="t">{f.name}</span><small>{regionsOf(f)} · {relDays(parseYmd(f.date))}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="as-method">
        Sunrise, sunset, Moon phases and planetary positions are astronomical calculations for {place}. Tithi, nakshatra, yoga, karana, Rahu Kalam, Yamagandam, Kuligai and auspicious days are traditional interpretations of those positions (Lahiri ayanamsa, Tamil and Indian conventions) — cultural guidance rather than scientific prediction.
      </p>

      {/* ── daily horoscope: a third-party reading, kept apart from the almanac ── */}
      <section className="as-horo" aria-labelledby="h-horo">
        <div className="as-horo-head">
          <div>
            <p className="as-horo-tag"><ExternalLink size={13} aria-hidden /> Third-party reading · not calculated here</p>
            <h2 id="h-horo">Daily horoscope</h2>
            <p className="as-horo-sub">A sun-sign forecast for today, fetched from an external horoscope service. It is separate from the almanac above and is for entertainment, not a verified prediction.</p>
          </div>
        </div>
        <div className="as-signs" role="group" aria-label="Zodiac sign">
          {ZODIAC.map((z, i) => (
            <button key={z} type="button" aria-pressed={s.zodiac === z} onClick={() => updateSettings({ zodiac: s.zodiac === z ? null : z })}>
              <span className="n">{s.zodiac === z && <Check size={14} strokeWidth={3} aria-hidden />}{z}</span>
              <span className="dt">{ZODIAC_DATES[i]}</span>
            </button>
          ))}
        </div>
        <div className="as-reading" aria-live="polite">
          {!s.zodiac && <p className="note-state">Choose your sign to read today's forecast.</p>}
          {s.zodiac && h.loading && !h.data && (
            <div className="as-skel" role="status" aria-label={`Loading today's forecast for ${s.zodiac}`}>
              <div className="skeleton" style={{ height: 18 }} /><div className="skeleton" style={{ height: 18, width: "82%" }} /><div className="skeleton" style={{ height: 18, width: "60%" }} />
            </div>
          )}
          {s.zodiac && h.error && <ErrorNote message={h.error} onRetry={h.refresh} stale={h.stale} />}
          {s.zodiac && h.data && (
            <article key={s.zodiac}>
              <p className="eyebrow">{s.zodiac} · {fmt(today(), { weekday: "long", day: "numeric", month: "long" })}{h.loading ? " · refreshing…" : ""}</p>
              <p className="as-overall">{h.data.overall}</p>
              {(h.data.love || h.data.career || h.data.health || h.data.lucky_number || h.data.lucky_color) && (
                <dl className="as-aspects">
                  {h.data.love && <div><dt>Love</dt><dd>{h.data.love}</dd></div>}
                  {h.data.career && <div><dt>Career</dt><dd>{h.data.career}</dd></div>}
                  {h.data.health && <div><dt>Health</dt><dd>{h.data.health}</dd></div>}
                  {(h.data.lucky_number || h.data.lucky_color) && <div><dt>Lucky</dt><dd className="big">{[h.data.lucky_number, h.data.lucky_color].filter(Boolean).join(" · ")}</dd></div>}
                </dl>
              )}
              <p className="as-horo-foot">A new reading is fetched every day. Horoscopes are for entertainment, not verified predictions.</p>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}
