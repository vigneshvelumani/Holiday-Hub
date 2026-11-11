import quotes from "../data/quotes.json";

export interface Thought {
  text: string;
  author: string;
}
const list = quotes as Thought[];

/** The original site's "thought for the day": one per day of the month, so every date has its own. */
export function thoughtFor(date: Date, offset = 0): Thought {
  return list[(date.getDate() - 1 + offset) % list.length];
}
export const thoughtCount = list.length;
