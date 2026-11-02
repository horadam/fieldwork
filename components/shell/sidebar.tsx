"use client";
import { tabs, type TabId } from "./tabs";

const Icon = ({ d, width = 1.8 }: { d: string; width?: number }) => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

export function Sidebar({
  tab,
  collapsed,
  onToggle,
  onSelect,
}: {
  tab: TabId;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (tab: TabId) => void;
}) {
  const toggleLabel = collapsed ? "Expand navigation" : "Collapse navigation";
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <p className="brand">
          <span className="sr-only">fieldwork</span>
          <span className="brand-full" aria-hidden="true">
            fieldwork
          </span>
          <span className="brand-short" aria-hidden="true">
            f
          </span>
          <span className="brand-mark" aria-hidden="true">
            ↗
          </span>
        </p>
        <button
          className="nav-toggle"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          onClick={onToggle}
        >
          <Icon d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} width={2} />
        </button>
      </div>
      <div className="eyebrow">Your next chapter</div>
      <nav aria-label="Workspace">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`nav ${tab === t.id ? "active" : ""}`}
            aria-current={tab === t.id ? "page" : undefined}
            title={collapsed ? t.label : undefined}
            onClick={() => onSelect(t.id)}
          >
            <span className="nav-icon">
              <Icon d={t.icon} />
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <p>
          Small steps.
          <br />
          Defensible experience.
          <br />
          Better conversations.
        </p>
      </div>
    </aside>
  );
}
