"use client";
import { useRef, type KeyboardEvent } from "react";

// An ARIA tablist: arrow keys move between tabs, and only the selected tab is
// in the tab order. The caller renders the panel with `tabPanelProps`.
export function Tabs<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === value);
    const next = items[(index + step + items.length) % items.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  }
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[item.id] = el;
          }}
          id={`${id}-tab-${item.id}`}
          role="tab"
          aria-selected={value === item.id}
          aria-controls={`${id}-panel`}
          tabIndex={value === item.id ? 0 : -1}
          className={value === item.id ? "selected" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function tabPanelProps(id: string, value: string) {
  return {
    id: `${id}-panel`,
    role: "tabpanel" as const,
    "aria-labelledby": `${id}-tab-${value}`,
  };
}
