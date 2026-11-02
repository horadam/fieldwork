// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import Workspace from "../../components/workspace";
import { BROWSER_STORAGE_KEY } from "../../lib/store";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        provider: "ollama",
        model: "qwen3:8b",
        ready: true,
        message: "ok",
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const nav = () => within(screen.getByRole("navigation", { name: "Workspace" }));

describe("workspace shell", () => {
  it("navigates by tab and moves focus to the view heading", async () => {
    render(<Workspace />);
    fireEvent.click(nav().getByRole("button", { name: "Experience" }));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Your evidence, in your words.");
    expect(document.activeElement).toBe(heading);
    expect(
      nav()
        .getByRole("button", { name: "Experience" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("adds an experience entry through the dialog and saves it in the browser", async () => {
    render(<Workspace />);
    fireEvent.click(nav().getByRole("button", { name: "Experience" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add experience" }));
    const dialog = screen.getByRole("dialog", {
      name: "Add user-confirmed experience",
    });
    fireEvent.change(within(dialog).getByLabelText("Experience title"), {
      target: { value: "Accessibility audit" },
    });
    fireEvent.change(within(dialog).getByLabelText("User-confirmed details"), {
      target: { value: "Led an accessibility audit of the checkout flow." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save experience" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = JSON.parse(localStorage.getItem(BROWSER_STORAGE_KEY)!);
    expect(saved.experience.map((e: { title: string }) => e.title)).toContain(
      "Accessibility audit",
    );
  });

  it("shows an error once, inside the open dialog", async () => {
    // Fill the bank to its limit so the next save fails.
    localStorage.setItem(
      BROWSER_STORAGE_KEY,
      JSON.stringify({
        jobs: [],
        runs: [],
        tasks: [],
        experience: Array.from({ length: 50 }, (_, i) => ({
          id: `e${i}`,
          title: `Entry ${i}`,
          body: "Body text here.",
        })),
      }),
    );
    render(<Workspace />);
    fireEvent.click(nav().getByRole("button", { name: "Experience" }));
    await screen.findByText("Entry 49");
    fireEvent.click(screen.getByRole("button", { name: "+ Add experience" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Experience title"), {
      target: { value: "One more" },
    });
    fireEvent.change(within(dialog).getByLabelText("User-confirmed details"), {
      target: { value: "This entry would exceed the limit." },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save experience" }),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "limited to 50",
      ),
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
