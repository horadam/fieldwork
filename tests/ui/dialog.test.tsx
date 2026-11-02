// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog } from "../../components/modals/dialog";

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  // An inline close callback is a new function on every render, as in the shell.
  return (
    <Dialog title="Edit" close={() => onClose()}>
      <input
        aria-label="Name"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Dialog>
  );
}

describe("Dialog", () => {
  it("keeps focus in the field while the parent re-renders", () => {
    render(<Harness onClose={() => {}} />);
    const input = screen.getByLabelText("Name");
    input.focus();
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    expect(document.activeElement).toBe(input);
  });

  it("labels the dialog by its title and closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses the first control on open and restores focus on close", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Harness onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Close dialog"));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
