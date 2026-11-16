import { useEffect, useState, type FormEvent } from "react";
import { Cake, Plus, Trash2 } from "lucide-react";
import { MONTHS, daysInMonth, fmtShort, isValidYmd, parseYmd, relDays, uid } from "../lib/dates.ts";
import { nextBirthday } from "../lib/items.ts";
import { describeRecurrence, type Freq, type Recurrence, type Unit } from "../lib/recurrence.ts";
import { toast } from "../lib/notify.ts";
import { allCategories, removeItem, saveItem, useData, useSettings, type CalEvent, type Priority, type Reminder, type Task, type TaskStatus } from "../lib/store.ts";
import { Empty, Field, Modal, Switch } from "./ui.tsx";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function RecurrenceEditor({ value, onChange, start }: { value: Recurrence; onChange: (r: Recurrence) => void; start: string }) {
  const startDow = isValidYmd(start) ? parseYmd(start).getDay() : 0;
  const weekly = value.freq === "weekly" || (value.freq === "custom" && (value.unit || "day") === "week");
  const days = value.weekdays?.length ? value.weekdays : [startDow];
  return (
    <div className="stack tight">
      <div className="grid2 keep">
        <Field label="Repeat">
          <select className="select" value={value.freq} onChange={(e) => onChange({ ...value, freq: e.target.value as Freq, interval: value.interval || 2, unit: value.unit || "day" })}>
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom…</option>
          </select>
        </Field>
        {value.freq !== "none" && (
          <Field label="Ends (optional)">
            <input className="input" type="date" value={value.until || ""} min={start} onChange={(e) => onChange({ ...value, until: e.target.value || undefined })} />
          </Field>
        )}
      </div>
      {value.freq === "custom" && (
        <div className="grid2 keep">
          <Field label="Every">
            <input className="input" type="number" min={1} max={999} value={value.interval || 1} onChange={(e) => onChange({ ...value, interval: Math.max(1, Math.floor(+e.target.value || 1)) })} />
          </Field>
          <Field label="Unit">
            <select className="select" value={value.unit || "day"} onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
              <option value="year">Years</option>
            </select>
          </Field>
        </div>
      )}
      {weekly && (
        <div className="field">
          <span className="label">On</span>
          <div className="row wrap" role="group" aria-label="Weekdays" style={{ gap: 6 }}>
            {DOW.map((d, i) => (
              <button
                key={i}
                type="button"
                className="btn sm icon"
                aria-pressed={days.includes(i)}
                aria-label={DOW_NAMES[i]}
                style={days.includes(i) ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : undefined}
                onClick={() => {
                  const next = days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort();
                  onChange({ ...value, weekdays: next.length ? next : [startDow] });
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}
      {value.freq !== "none" && <div className="small muted">{describeRecurrence(value)}</div>}
    </div>
  );
}

/** One validation message at a time, shown under its field; the field is focused and marked invalid. */
function useFieldError() {
  const [err, setErr] = useState<{ field: string; msg: string } | null>(null);
  return {
    fail: (field: string, msg: string) => {
      setErr({ field, msg });
      requestAnimationFrame(() => document.getElementById("f-" + field)?.focus());
    },
    clear: () => setErr(null),
    bind: (field: string) => ({ id: "f-" + field, "aria-invalid": err?.field === field || undefined }),
    msg: (field: string) => (err?.field === field ? err.msg : undefined),
  };
}

function Foot({ onDelete, deleteHint, onClose, saveLabel }: { onDelete?: () => void; deleteHint?: string; onClose: () => void; saveLabel: string }) {
  // Delete asks once more in place (no browser confirm box); the question withdraws itself after a few seconds
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <>
      {onDelete && (
        <span className="row" style={{ marginRight: "auto", minWidth: 0 }}>
          <button type="button" className="btn danger" style={armed ? { background: "var(--danger)", borderColor: "var(--danger)", color: "var(--surface)" } : undefined} onClick={() => (armed ? onDelete() : setArmed(true))} onBlur={() => setArmed(false)}>
            <Trash2 size={14} /> {armed ? "Confirm delete" : "Delete"}
          </button>
          <span className="small muted hide-sm" role="status">{armed ? deleteHint || "This can't be undone." : ""}</span>
        </span>
      )}
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" form="item-form" className="btn primary">
        {saveLabel}
      </button>
    </>
  );
}

export function TaskForm({ initial, isNew, onClose }: { initial: Task; isNew: boolean; onClose: () => void }) {
  const s = useSettings();
  const [t, setT] = useState<Task>(initial);
  const v = useFieldError();
  const set = (p: Partial<Task>) => (v.clear(), setT((x) => ({ ...x, ...p })));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!t.title.trim()) return v.fail("title", "Give the task a title.");
    if (!isValidYmd(t.dueDate)) return v.fail("due", "Choose a valid due date.");
    if (t.startDate && t.startDate > t.dueDate) return v.fail("start", "The start date must be on or before the due date.");
    if (!t.allDay && t.startTime && t.endTime && t.endTime < t.startTime) return v.fail("end", "The end time must be after the start time.");
    saveItem("tasks", { ...t, title: t.title.trim(), completedAt: t.status === "done" ? t.completedAt || Date.now() : undefined });
    toast(isNew ? "Task added" : "Task updated", t.title.trim(), "ok");
    onClose();
  };
  const del = () => {
    removeItem("tasks", t.id);
    toast("Task deleted");
    onClose();
  };
  return (
    <Modal title={isNew ? "New task" : "Edit task"} onClose={onClose} footer={<Foot onDelete={isNew ? undefined : del} deleteHint={t.recurrence.freq === "none" ? undefined : "Deletes every occurrence of this repeating task."} onClose={onClose} saveLabel={isNew ? "Add task" : "Save changes"} />}>
      <form id="item-form" className="stack" onSubmit={submit} noValidate>
        <Field label="Title" error={v.msg("title")}>
          <input className="input" data-autofocus {...v.bind("title")} value={t.title} onChange={(e) => set({ title: e.target.value })} placeholder="What needs doing?" maxLength={200} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={t.description || ""} onChange={(e) => set({ description: e.target.value })} rows={2} />
        </Field>
        <div className="grid2 keep">
          <Field label="Start date" error={v.msg("start")}>
            <input className="input" type="date" {...v.bind("start")} value={t.startDate || ""} onChange={(e) => set({ startDate: e.target.value || undefined })} />
          </Field>
          <Field label="Due date" error={v.msg("due")}>
            <input className="input" type="date" required {...v.bind("due")} value={t.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
          </Field>
        </div>
        <div className="switch-row">
          <span className="label">All-day task</span>
          <Switch checked={t.allDay} onChange={(v) => set({ allDay: v, startTime: v ? undefined : t.startTime || "09:00", endTime: v ? undefined : t.endTime || "10:00" })} label="All-day task" />
        </div>
        {!t.allDay && (
          <div className="grid2 keep">
            <Field label="Start time">
              <input className="input" type="time" value={t.startTime || ""} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End time" error={v.msg("end")}>
              <input className="input" type="time" {...v.bind("end")} value={t.endTime || ""} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>
        )}
        <div className="grid3">
          <Field label="Priority">
            <select className="select" value={t.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
          <Field label="Category">
            <select className="select" value={t.category} onChange={(e) => set({ category: e.target.value })}>
              {allCategories(s).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={t.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              <option value="todo">To do</option>
              <option value="in_progress">In progress</option>
              <option value="done">Completed</option>
            </select>
          </Field>
        </div>
        <RecurrenceEditor value={t.recurrence} onChange={(r) => set({ recurrence: r })} start={t.dueDate} />
        <Field label="Notes">
          <textarea className="textarea" value={t.notes || ""} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="Anything else worth remembering" />
        </Field>
      </form>
    </Modal>
  );
}

const LEADS: [number, string][] = [[0, "At the scheduled time"], [5, "5 minutes before"], [10, "10 minutes before"], [15, "15 minutes before"], [30, "30 minutes before"], [60, "1 hour before"], [1440, "1 day before"]];

export function ReminderForm({ initial, isNew, onClose }: { initial: Reminder; isNew: boolean; onClose: () => void }) {
  const [r, setR] = useState<Reminder>(initial);
  const [custom, setCustom] = useState(!LEADS.some(([m]) => m === initial.lead));
  const v = useFieldError();
  const set = (p: Partial<Reminder>) => (v.clear(), setR((x) => ({ ...x, ...p })));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!r.message.trim()) return v.fail("message", "Write the reminder message.");
    if (!isValidYmd(r.date)) return v.fail("date", "Choose a valid date.");
    if (!r.time) return v.fail("time", "Choose a time.");
    // changing when it is due re-arms the notification
    const rearm = r.date !== initial.date || r.time !== initial.time || r.lead !== initial.lead;
    saveItem("reminders", { ...r, message: r.message.trim(), fired: rearm ? [] : r.fired });
    toast(isNew ? "Reminder set" : "Reminder updated", `${r.message.trim()} · ${fmtShort(parseYmd(r.date))} ${r.time}`, "ok");
    onClose();
  };
  const del = () => {
    removeItem("reminders", r.id);
    toast("Reminder deleted");
    onClose();
  };
  return (
    <Modal title={isNew ? "New reminder" : "Edit reminder"} onClose={onClose} footer={<Foot onDelete={isNew ? undefined : del} onClose={onClose} saveLabel={isNew ? "Set reminder" : "Save changes"} />}>
      <form id="item-form" className="stack" onSubmit={submit} noValidate>
        <Field label="Message" error={v.msg("message")}>
          <input className="input" data-autofocus {...v.bind("message")} value={r.message} onChange={(e) => set({ message: e.target.value })} placeholder="Remind me to…" maxLength={200} />
        </Field>
        <div className="grid2 keep">
          <Field label="Date" error={v.msg("date")}>
            <input className="input" type="date" required {...v.bind("date")} value={r.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Time" error={v.msg("time")}>
            <input className="input" type="time" required {...v.bind("time")} value={r.time} onChange={(e) => set({ time: e.target.value })} />
          </Field>
        </div>
        <div className="grid2">
          <Field label="Notify me">
            <select
              className="select"
              value={custom ? "custom" : String(r.lead)}
              onChange={(e) => {
                if (e.target.value === "custom") setCustom(true);
                else (setCustom(false), set({ lead: +e.target.value }));
              }}
            >
              {LEADS.map(([m, l]) => (
                <option key={m} value={m}>{l}</option>
              ))}
              <option value="custom">Custom time before…</option>
            </select>
          </Field>
          {custom && (
            <Field label="Minutes before" hint="e.g. 120 = 2 hours, 2880 = 2 days">
              <input className="input" type="number" min={0} max={525600} value={r.lead} onChange={(e) => set({ lead: Math.max(0, Math.floor(+e.target.value || 0)) })} />
            </Field>
          )}
        </div>
        <RecurrenceEditor value={r.recurrence} onChange={(rec) => set({ recurrence: rec })} start={r.date} />
      </form>
    </Modal>
  );
}

export function EventForm({ initial, isNew, onClose }: { initial: CalEvent; isNew: boolean; onClose: () => void }) {
  const s = useSettings();
  const [ev, setEv] = useState<CalEvent>(initial);
  const v = useFieldError();
  const set = (p: Partial<CalEvent>) => (v.clear(), setEv((x) => ({ ...x, ...p })));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ev.title.trim()) return v.fail("title", "Give the event a title.");
    if (!isValidYmd(ev.date)) return v.fail("date", "Choose a valid date.");
    if (!ev.allDay && ev.startTime && ev.endTime && ev.endTime < ev.startTime) return v.fail("end", "The end time must be after the start time.");
    saveItem("events", { ...ev, title: ev.title.trim() });
    toast(isNew ? "Event added" : "Event updated", ev.title.trim(), "ok");
    onClose();
  };
  const del = () => {
    removeItem("events", ev.id);
    toast("Event deleted");
    onClose();
  };
  return (
    <Modal title={isNew ? "New event" : "Edit event"} onClose={onClose} footer={<Foot onDelete={isNew ? undefined : del} onClose={onClose} saveLabel={isNew ? "Add event" : "Save changes"} />}>
      <form id="item-form" className="stack" onSubmit={submit} noValidate>
        <Field label="Title" error={v.msg("title")}>
          <input className="input" data-autofocus {...v.bind("title")} value={ev.title} onChange={(e) => set({ title: e.target.value })} placeholder="Team standup, gym, anniversary…" maxLength={200} />
        </Field>
        <div className="grid2 keep">
          <Field label="Date" error={v.msg("date")}>
            <input className="input" type="date" required {...v.bind("date")} value={ev.date} onChange={(e) => set({ date: e.target.value })} />
          </Field>
          <Field label="Category">
            <select className="select" value={ev.category} onChange={(e) => set({ category: e.target.value })}>
              {allCategories(s).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="switch-row">
          <span className="label">All-day event</span>
          <Switch checked={ev.allDay} onChange={(v) => set({ allDay: v, startTime: v ? undefined : ev.startTime || "09:00", endTime: v ? undefined : ev.endTime || "10:00" })} label="All-day event" />
        </div>
        {!ev.allDay && (
          <div className="grid2 keep">
            <Field label="Start time">
              <input className="input" type="time" value={ev.startTime || ""} onChange={(e) => set({ startTime: e.target.value })} />
            </Field>
            <Field label="End time" error={v.msg("end")}>
              <input className="input" type="time" {...v.bind("end")} value={ev.endTime || ""} onChange={(e) => set({ endTime: e.target.value })} />
            </Field>
          </div>
        )}
        <RecurrenceEditor value={ev.recurrence} onChange={(r) => set({ recurrence: r })} start={ev.date} />
        <Field label="Description">
          <textarea className="textarea" value={ev.description || ""} onChange={(e) => set({ description: e.target.value })} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}

export function BirthdaysModal({ onClose }: { onClose: () => void }) {
  const { birthdays } = useData();
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [day, setDay] = useState(new Date().getDate());
  const [year, setYear] = useState("");
  const maxDay = daysInMonth(2024, month - 1); // leap year so 29 Feb can be entered
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const y = Number(year);
    saveItem("birthdays", { id: uid(), name: name.trim(), month, day: Math.min(day, maxDay), year: year && y > 1800 && y <= new Date().getFullYear() ? y : undefined });
    toast("Birthday added", name.trim(), "ok");
    setName("");
    setYear("");
  };
  const sorted = [...birthdays].sort((a, b) => nextBirthday(a).getTime() - nextBirthday(b).getTime());
  return (
    <Modal title="Birthdays" onClose={onClose}>
      <form className="stack" onSubmit={add}>
        <Field label="Person">
          <input className="input" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={80} />
        </Field>
        <div className="grid3 bday-grid">
          <Field label="Month">
            <select className="select" value={month} onChange={(e) => setMonth(+e.target.value)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Day">
            <input className="input" type="number" min={1} max={maxDay} value={day} onChange={(e) => setDay(Math.max(1, Math.min(maxDay, +e.target.value || 1)))} />
          </Field>
          <Field label="Year (optional)">
            <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="1990" />
          </Field>
        </div>
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Add birthday
        </button>
      </form>
      <div className="form-group">
        <h3 className="eyebrow" style={{ margin: 0 }}>Saved birthdays{sorted.length ? ` · ${sorted.length}` : ""}</h3>
      <div className="card list">
        {sorted.length === 0 ? (
          <Empty title="No birthdays yet">Add a name and date above to see it on the calendar every year.</Empty>
        ) : (
          sorted.map((b) => (
            <div className="list-row" key={b.id} style={{ alignItems: "center" }}>
              <Cake size={15} style={{ color: "var(--c-birthday)" }} />
              <div className="grow">
                <div className="strong truncate">{b.name}</div>
                <div className="small muted">
                  {MONTHS[b.month - 1]} {b.day}
                  {b.year ? ` · ${b.year}` : ""} · {relDays(nextBirthday(b))}
                </div>
              </div>
              <button className="btn ghost icon sm danger" aria-label={`Delete ${b.name}'s birthday`} title="Delete" onClick={() => (removeItem("birthdays", b.id), toast("Birthday deleted", b.name))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      </div>
    </Modal>
  );
}
