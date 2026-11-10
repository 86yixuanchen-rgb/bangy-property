export function timeDisplay(v: unknown) {
  if (!v) return "";
  const d = new Date(v as string | number);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(" ", "T");
}
// Interpret the displayed wall clock in Sydney, independent of browser timezone.
export function sydneyTimestamp(value: string) {
  if (!value) return "";
  const naive = Date.parse(value + "Z");
  let target = naive;
  for (let i = 0; i < 3; i++) {
    const displayed = timeDisplay(target);
    target += naive - Date.parse(displayed + "Z");
  }
  if (timeDisplay(target) !== value)
    throw new Error("This time does not exist because of daylight saving. Choose another time.");
  return target;
}
