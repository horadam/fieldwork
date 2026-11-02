"use client";

// The one confirm-before-delete pattern; `consequence` says what else changes.
export function ConfirmDeleteBody({
  consequence,
  busy,
  confirmLabel = "Delete record",
  onConfirm,
  onCancel,
}: {
  consequence: string;
  busy: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <p>{consequence}</p>
      <div className="actions">
        <button className="button danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="button secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
