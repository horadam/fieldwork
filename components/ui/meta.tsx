// A row of short facts about an item (dates, minutes, type), visually
// separate from its content. Items are separated by dots in CSS; empty
// items are skipped.
export function Meta({ items }: { items: React.ReactNode[] }) {
  const shown = items.filter(
    (item) => item !== null && item !== false && item !== "",
  );
  if (!shown.length) return null;
  return (
    <p className="meta">
      {shown.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
    </p>
  );
}

// "Nov 6 – Nov 12" for ISO dates, shown the same in every time zone.
export function dateRange(start: string, end: string) {
  const format = (value: string) =>
    new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return start === end ? format(start) : `${format(start)} – ${format(end)}`;
}
