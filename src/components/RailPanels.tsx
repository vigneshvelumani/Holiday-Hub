// The rounded dark panels under the navigation on the black rail:
// the mini month, the open to-dos of the next seven days, and the calendar layers.
// The layer switches write the same settings as the Calendar page's chips and filters,
// so a change here filters every calendar in the app.

import { useMemo, useState } from "react";
import { Check as CheckIcon, ChevronDown, Plus } from "lucide-react";
import { fmtTime, parseYmd, relDays, today, ymd } from "../lib/dates.ts";
import { CATEGORY_LABEL, HOLIDAY_CATEGORIES } from "../lib/holidays.ts";
import { itemsBetween, toggleReminder, toggleTask, type DayItem, type ItemType } from "../lib/items.ts";
import { updateSettings, useData, useSettings, type Settings } from "../lib/store.ts";
import { MiniMonth } from "./MiniMonth.tsx";
import { Check, tone, useItemClick, useUi } from "./ui.tsx";

const TODO_TYPES = new Set<ItemType>(["task", "reminder"]);
const SHOWN = 4;

/** Open tasks and reminders that fall in the next seven days (today included). */
export function QuickTodos() {
  const ui = useUi();
  const data = useData();
  const s = useSettings();
  const onItem = useItemClick();
  const now = today();
  const open = useMemo(() => {
    // the list is about what is due, whatever the calendar layers currently show
    const all: Settings = { ...s, layers: { ...s.layers, tasks: true, reminders: true } };
    const seen = new Set<string>();
    const out: DayItem[] = [];
    for (const day of itemsBetween(now, 7, data, all, { types: TODO_TYPES })) {
      for (const i of day.items) {
        if (i.done || seen.has(i.key)) continue; // a repeating item is listed once, on its next day
        seen.add(i.key);
        out.push(i);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, s, ymd(now)]);
  return (
    <section className="rail-panel" aria-labelledby="rail-todo">
      <div className="rail-head">
        <h2 id="rail-todo">To do this week</h2>
        {open.length > 0 && <span className="rail-count num" aria-label={`${open.length} open`}>{open.length}</span>}
      </div>
      {open.length === 0 ? (
        <p className="rail-empty">Nothing open in the next 7 days.</p>
      ) : (
        <ul className="rail-todos">
          {open.slice(0, SHOWN).map((i) => (
            <li key={i.key}>
              <Check checked={false} label={`Done: ${i.title}`} onChange={() => (i.task ? toggleTask(i.task, i.date) : i.reminder && toggleReminder(i.reminder, i.date))} />
              <button type="button" className="txt" onClick={() => onItem(i)}>
                <span className="t truncate">{i.title}</span>
                <span className="m">{relDays(parseYmd(i.date))}{i.time ? ` · ${fmtTime(i.time, s.hour12)}` : ""} · {i.task ? "Task" : "Reminder"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.length > SHOWN && <button type="button" className="rail-row" onClick={() => ui.go("tasks")}>+{open.length - SHOWN} more this week</button>}
      <button type="button" className="rail-row add" onClick={() => ui.editTask(null, ymd(today()))}><Plus size={16} aria-hidden /> New task</button>
    </section>
  );
}

const CATS = [...HOLIDAY_CATEGORIES.slice(0, 4), "birthday" as const, ...HOLIDAY_CATEGORIES.slice(4)];
const ITEM_LAYERS: [keyof Settings["layers"], string, string][] = [["tasks", "Tasks", "task"], ["reminders", "Reminders", "reminder"], ["events", "Events", "event"]];
const MORE_LAYERS: [keyof Settings["layers"], string, string][] = [
  ["officeSaturday", "Office Saturday labels", "worksat"],
  ["bankSaturday", "Bank Saturday status", "bank_govt"],
  ["weather", "Weather forecast", "international"],
  ["salary", "Salary day", "salary"],
  ["notes", "Note markers", "ink"],
];

function LayerRow({ on, label, toneName, onChange }: { on: boolean; label: string; toneName: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="rail-check" role="checkbox" aria-checked={on} onClick={() => onChange(!on)} style={tone(toneName)}>
      <span className="box" aria-hidden><CheckIcon size={12} strokeWidth={3.2} /></span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Which holiday categories and item layers every calendar shows. */
export function CalendarsPanel() {
  const s = useSettings();
  const [more, setMore] = useState(false);
  const layer = ([k, label, t]: [keyof Settings["layers"], string, string]) => (
    <LayerRow key={k} on={s.layers[k]} label={label} toneName={t} onChange={(v) => updateSettings({ layers: { ...s.layers, [k]: v } })} />
  );
  return (
    <section className="rail-panel" aria-labelledby="rail-cals">
      <div className="rail-head"><h2 id="rail-cals">Calendars</h2></div>
      <div className="rail-group" role="group" aria-label="Holiday calendars shown">
        {CATS.map((c) => (
          <LayerRow key={c} on={!!s.categories[c]} label={CATEGORY_LABEL[c]} toneName={c} onChange={(v) => updateSettings({ categories: { ...s.categories, [c]: v } })} />
        ))}
      </div>
      <div className="rail-sub">My items</div>
      <div className="rail-group" role="group" aria-label="My items shown">{ITEM_LAYERS.map(layer)}</div>
      <button type="button" className="rail-row" aria-expanded={more} onClick={() => setMore((m) => !m)}>
        <ChevronDown size={16} aria-hidden className={"chev" + (more ? " up" : "")} /> More layers
      </button>
      {more && <div className="rail-group" role="group" aria-label="More layers shown">{MORE_LAYERS.map(layer)}</div>}
    </section>
  );
}

/** Everything below the navigation on the expanded rail. */
export function RailPanels() {
  return (
    <div className="rail-panels">
      <MiniMonth />
      <QuickTodos />
      <CalendarsPanel />
    </div>
  );
}
