"use client";
import { useEffect, useId, useRef } from "react";

const focusableSelector =
  "button,input,textarea,select,summary,a[href],[tabindex]:not([tabindex='-1'])";

export function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Parents pass a new close callback on every render; reading it through a
  // ref keeps focus setup to mount only, so typing never loses focus.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current!;
    const focusable = () =>
      Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (e) => !e.hasAttribute("disabled"),
      );
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="dialog-shade">
      <div
        className="dialog"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-top">
          <h2 id={titleId}>{title}</h2>
          <button className="close" aria-label="Close dialog" onClick={close}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
