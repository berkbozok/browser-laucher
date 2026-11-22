/** "1 window", "3 windows". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Safari", "Safari and Orion", "Safari, Orion and Brave". */
export const nameList = new Intl.ListFormat("en", { type: "conjunction" });
