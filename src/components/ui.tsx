import { createContext, useContext, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Bell, Briefcase, Cake, CalendarDays, Check as CheckIcon, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Flag, Landmark, Loader2, Moon, Palmtree, RefreshCw, Square, SquareCheck, Sun, Wallet, X, Smile, Meh, Frown } from "lucide-react";
import type { DayItem } from "../lib/items.ts";
import { fmtTime, parseYmd, type Ymd } from "../lib/dates.ts";
import { SATURDAY_LABEL, type SaturdayStatus } from "../lib/saturday.ts";
import { weatherGlyph, weatherLabel } from "../lib/services.ts";
import type { CalEvent, MoodValue, Reminder, Task, ViewName } from "../lib/store.ts";

// ── app-wide UI actions ──────────────────────────────────────────────────────
export type Route = "dashboard" | "calendar" | "tasks" | "reminders" | "holidays" | "news" | "weather" | "astrology" | "world" | "settings";
export interface Ui {
  route: Route;
  go: (r: Route) => void;
  focus: Date;
  setFocus: (d: Date) => void;
  view: ViewName;
  setView: (v: ViewName) => void;
  /** open the popup that shows everything on a date */
  openDay: (d: Date) => void;
  editTask: (t: Task | null, date?: Ymd, patch?: Partial<Task>) => void;
  editReminder: (r: Reminder | null, date?: Ymd) => void;
  editEvent: (e: CalEvent | null, date?: Ymd) => void;
  manageBirthdays: () => void;
  /** open the location dialog */
  openLocation: () => void;
  /** open an article in the in-app reader */
  readArticle: (id: string) => void;
}
export const UiContext = createContext<Ui>(null as unknown as Ui);
export const useUi = () => useContext(UiContext);

export const tone = (name: string): CSSProperties => ({ ["--tone" as string]: `var(--c-${name})` });

// ── primitives ───────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea, a[href]");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    const auto = ref.current?.querySelector<HTMLElement>("[data-autofocus]") || ref.current?.querySelector<HTMLElement>("input, textarea, select");
    auto?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="btn ghost icon sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" className="check" role="checkbox" aria-checked={checked} aria-label={label} title={label} onClick={(e) => (e.stopPropagation(), onChange())}>
      <CheckIcon size={13} strokeWidth={3} />
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="list-row" style={{ alignItems: "center" }}>
      <div className="grow">
        <div className="strong">{title}</div>
        {desc && <div className="small muted">{desc}</div>}
      </div>
      <div className="row" style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty row" style={{ justifyContent: "center" }} role="status">
      <Loader2 size={16} className="spin" /> {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry, stale }: { message: string; onRetry?: () => void; stale?: boolean }) {
  return (
    <div className="notice err" role="alert">
      <AlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
      <div className="grow">
        {message}
        {stale && " Showing the last saved copy."}
      </div>
      {onRetry && (
        <button className="btn sm" onClick={onRetry}>
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export function WeatherIcon({ code, isDay = true, size = 16 }: { code: number; isDay?: boolean; size?: number }) {
  const g = weatherGlyph(code, isDay);
  const Icon = { sun: Sun, moon: Moon, partly: CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning }[g];
  return <Icon size={size} aria-label={weatherLabel(code)} className={"wx-" + g} />;
}

export function SatTag({ status, size = "sm", long, solid }: { status: SaturdayStatus; size?: "sm" | "lg" | "cell"; long?: boolean; solid?: boolean }) {
  const L = SATURDAY_LABEL[status];
  const text = long ? L.long : size === "sm" ? L.tiny : L.short;
  return (
    <span className={`sat-tag ${status} ${size === "lg" ? "lg" : ""} ${solid ? "solid" : ""}`} title={`${L.long} — office schedule (fixed rule)`}>
      {status === "working" ? <Briefcase size={size === "sm" ? 11 : 14} /> : <Palmtree size={size === "sm" ? 11 : 14} />}
      {size === "cell" ? <><span className="full">{L.short}</span><span className="tiny" aria-hidden>{status === "working" ? "Work" : "Off"}</span></> : text}
    </span>
  );
}

export function ItemIcon({ item, size = 11 }: { item: DayItem; size?: number }) {
  switch (item.type) {
    case "holiday":
      return item.holiday?.kind === "bank" ? <Landmark size={size} /> : <Flag size={size} />;
    case "task":
      return item.done ? <SquareCheck size={size} /> : <Square size={size} />;
    case "reminder":
      return <Bell size={size} />;
    case "event":
      return <CalendarDays size={size} />;
    case "birthday":
      return <Cake size={size} />;
    case "salary":
      return <Wallet size={size} />;
  }
}

export function ItemChip({ item, onClick, draggable, hour12 = true, showTime = true }: { item: DayItem; onClick?: (i: DayItem) => void; draggable?: boolean; hour12?: boolean; showTime?: boolean }) {
  const canDrag = draggable && (item.type === "task" || item.type === "reminder" || item.type === "event");
  const kind = item.holiday?.kind;
  return (
    <button
      type="button"
      className={`item ${item.done ? "done" : ""} ${kind === "observance" ? "observance" : ""} ${kind === "bank" ? "bank" : ""}`}
      style={tone(item.tone)}
      draggable={canDrag || undefined}
      onDragStart={canDrag ? (e) => (e.dataTransfer.setData("text/plain", JSON.stringify({ key: item.key, date: item.date })), (e.dataTransfer.effectAllowed = "move")) : undefined}
      onClick={(e) => (e.stopPropagation(), onClick?.(item))}
      title={`${item.title} — ${item.label}${item.time ? " · " + fmtTime(item.time, hour12) : ""}${item.holiday?.note ? "\n" + item.holiday.note : ""}`}
    >
      <ItemIcon item={item} />
      <span className="t">
        {showTime && item.time ? <span className="num muted">{fmtTime(item.time, hour12)} </span> : null}
        {item.title}
      </span>
    </button>
  );
}

/** A coloured dot whose shape also encodes the type (for compact mobile cells). */
export function ItemDot({ item }: { item: DayItem }) {
  const cls = item.type === "holiday" ? "dot sq" : item.type === "reminder" ? "dot ring" : "dot";
  return <span className={cls} style={tone(item.tone)} />;
}

export const MOODS: { value: MoodValue; label: string; Icon: typeof Smile }[] = [
  { value: "happy", label: "Happy", Icon: Smile },
  { value: "neutral", label: "Neutral", Icon: Meh },
  { value: "sad", label: "Sad", Icon: Frown },
];

/** What happens when an item chip is clicked anywhere in the app. */
export function useItemClick() {
  const ui = useUi();
  return (i: DayItem) => {
    if (i.task) ui.editTask(i.task);
    else if (i.reminder) ui.editReminder(i.reminder);
    else if (i.event) ui.editEvent(i.event);
    else if (i.birthday) ui.manageBirthdays();
    else ui.openDay(parseYmd(i.date));
  };
}

/** The Moon as it looks for a given Sun–Moon elongation (0 = new, 180 = full). */
export function MoonDisc({ elongation, size = 96, dark }: { elongation: number; size?: number; /** on a night-sky background: unlit side dark, lit side pale */ dark?: boolean }) {
  const e = ((elongation % 360) + 360) % 360;
  const r = 46;
  const k = Math.cos((e * Math.PI) / 180); // +1 new … −1 full
  const waxing = e <= 180;
  // lit limb is a half circle; the terminator is a half ellipse with x-radius |k|·r
  const lit = `M 50 ${50 - r} A ${r} ${r} 0 0 ${waxing ? 1 : 0} 50 ${50 + r} A ${Math.abs(k) * r} ${r} 0 0 ${(k > 0) === waxing ? 0 : 1} 50 ${50 - r} Z`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Moon, ${Math.round(((1 - k) / 2) * 100)}% illuminated`}>
      <circle cx="50" cy="50" r={r} fill={dark ? "#1a2240" : "var(--surface-2)"} stroke={dark ? "#4a5788" : "var(--line-strong)"} />
      <path d={lit} fill={dark ? "#f3ecd6" : "var(--c-reminder)"} opacity={dark ? 1 : 0.85} style={{ transition: "d 0.6s ease" }} />
      {/* maria: faint, fixed markings so the disc reads as the Moon rather than a plain circle */}
      <g fill={dark ? "#1a2240" : "var(--ink)"} opacity={dark ? 0.1 : 0.07}>
        <circle cx="38" cy="36" r="9" /><circle cx="60" cy="30" r="6" /><circle cx="64" cy="56" r="10" /><circle cx="42" cy="64" r="7" /><circle cx="30" cy="52" r="4" />
      </g>
    </svg>
  );
}
