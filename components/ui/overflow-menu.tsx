"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";

// A ⋯ menu of actions: closes on an outside click or Escape, moves with
// the arrow keys, and returns focus to its button.
export function OverflowMenu({
  label,
  items,
}: {
  label: string;
  items: {
    label: string;
    onSelect: () => void;
    danger?: boolean;
    disabled?: boolean;
  }[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const enabled = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [],
    );
  // Closing from the keyboard returns focus to the trigger.
  const close = (refocus: boolean) => {
    if (!ref.current?.open) return;
    ref.current.open = false;
    if (refocus) trigger.current?.focus();
  };
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape")
        close(!!ref.current?.contains(document.activeElement));
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = enabled();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (move === undefined || !items.length) return;
    event.preventDefault();
    items[move].focus();
  }
  return (
    <details
      className="menu"
      ref={ref}
      onToggle={() => {
        if (ref.current?.open) enabled()[0]?.focus();
      }}
    >
      <summary
        ref={trigger}
        className="button secondary icon-button"
        aria-label={label}
        aria-haspopup="menu"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </summary>
      <div
        className="menu-list"
        role="menu"
        aria-label={label}
        ref={list}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.danger ? "danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              close(false);
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}
