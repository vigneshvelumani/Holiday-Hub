// "Export month as PDF" — carried over from the original site, now including
// reminders and the office Saturday schedule. jsPDF is loaded only when used.

import { addDays, daysInMonth, fmt, mkDate, ymd } from "./dates.ts";
import { CATEGORY_LABEL, primaryCategory } from "./holidays.ts";
import { enabledCategories, itemsOn } from "./items.ts";
import { bankSaturday, officeSaturday } from "./saturday.ts";
import type { DataState, Settings } from "./store.ts";

export async function exportMonthPdf(month: Date, data: DataState, s: Settings): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const left = 48;
  const width = doc.internal.pageSize.getWidth() - left * 2;
  let y = 56;
  const room = (h = 16) => {
    if (y + h > 780) {
      doc.addPage();
      y = 56;
    }
  };
  const heading = (t: string) => {
    room(34);
    y += 10;
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(20);
    doc.text(t, left, y);
    y += 6;
    doc.setDrawColor(210).line(left, y, left + width, y);
    y += 16;
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(50);
  };
  const line = (t: string) => {
    for (const part of doc.splitTextToSize(t, width) as string[]) {
      room();
      doc.text(part, left, y);
      y += 15;
    }
  };
  const empty = (t: string) => {
    doc.setTextColor(140);
    line(t);
    doc.setTextColor(50);
  };

  const Y = month.getFullYear();
  const M = month.getMonth();
  const days = Array.from({ length: daysInMonth(Y, M) }, (_, i) => mkDate(Y, M, i + 1));
  const perDay = days.map((d) => ({ d, items: itemsOn(d, data, s) }));
  const dl = (d: Date) => fmt(d, { weekday: "short", day: "numeric", month: "short" });

  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(20);
  doc.text(fmt(month, { month: "long", year: "numeric" }), left, y);
  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
  doc.text("Holiday Hub — holidays, office schedule, tasks and reminders", left, y);
  y += 8;

  const cats = enabledCategories(s);
  heading("Holidays");
  const hol = perDay.flatMap((p) => p.items.filter((i) => i.holiday).map((i) => `${dl(p.d)}  ·  ${i.title}  (${CATEGORY_LABEL[primaryCategory(i.holiday!, cats)]})`));
  hol.length ? hol.forEach(line) : empty("No holidays this month for the selected categories.");

  heading("Office Saturdays");
  days.filter((d) => d.getDay() === 6).forEach((d) => line(`${dl(d)}  —  ${officeSaturday(d) === "working" ? "WORKING SATURDAY" : "NON-WORKING SATURDAY (holiday)"}   ·   Banks ${bankSaturday(d) === "closed" ? "closed" : "open"}`));

  heading("Notes");
  const notes = data.notes.filter((n) => n.id.startsWith(ymd(days[0]).slice(0, 7)) && n.content.trim()).sort((a, b) => a.id.localeCompare(b.id));
  notes.length ? notes.forEach((n) => line(`${dl(addDays(days[0], Number(n.id.slice(8)) - 1))}  ·  ${n.content.replace(/\s+/g, " ")}`)) : empty("No notes this month.");

  const section = (title: string, type: string, none: string) => {
    heading(title);
    const rows = perDay.flatMap((p) => p.items.filter((i) => i.type === type).map((i) => `${dl(p.d)}  ·  ${i.done ? "[x] " : type === "task" ? "[ ] " : ""}${i.time ? i.time + "  " : ""}${i.title}${i.task ? `  (${i.task.category}, ${i.task.priority})` : ""}`));
    rows.length ? rows.forEach(line) : empty(none);
  };
  section("Tasks", "task", "No tasks this month.");
  section("Reminders", "reminder", "No reminders this month.");
  section("Events", "event", "No events this month.");
  section("Birthdays", "birthday", "No birthdays this month.");

  room(30);
  y += 14;
  doc.setFontSize(8).setTextColor(150);
  doc.text(`Generated ${new Date().toLocaleString()}`, left, y);
  doc.save(`calendar-${ymd(days[0]).slice(0, 7)}.pdf`);
}
