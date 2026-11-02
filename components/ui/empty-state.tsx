// The one empty-state pattern: what is missing, why it matters, and the next step.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="muted">{children}</p>
      {action && (
        <button
          className="button"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
