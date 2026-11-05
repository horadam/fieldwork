// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoNotice } from "../../components/shell/demo-notice";
import { Topbar } from "../../components/shell/topbar";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("demo notice", () => {
  const setup = () => {
    const handlers = { onAddKey: vi.fn(), onOpenApplications: vi.fn() };
    render(<DemoNotice {...handlers} />);
    return handlers;
  };

  it("explains the sample data, where data goes, and both ways to try AI", async () => {
    const handlers = setup();
    const notice = await screen.findByRole("region", {
      name: "About this demo",
    });
    expect(notice.textContent).toContain("synthetic sample data");
    expect(notice.textContent).toContain("saved only in this browser");
    expect(notice.textContent).toContain("Simulated preview");
    expect(notice.textContent).toContain("not stored here");
    fireEvent.click(
      screen.getByRole("button", { name: "Add your OpenAI key" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Applications" }));
    expect(handlers.onAddKey).toHaveBeenCalled();
    expect(handlers.onOpenApplications).toHaveBeenCalled();
  });

  it("stays dismissed in this browser", async () => {
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss this notice" }),
    );
    expect(screen.queryByRole("region")).toBeNull();
    cleanup();
    setup();
    await Promise.resolve();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("still shows, and can be closed, when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss this notice" }),
    );
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("status pill without a model", () => {
  it("says so plainly instead of naming the server's provider", () => {
    render(
      <Topbar
        section="Overview"
        mode="demo"
        email=""
        ai={{
          provider: "ollama",
          model: "qwen3:8b",
          ready: false,
          allowed: false,
          local: false,
          message: "Add your own OpenAI key in the model panel.",
        }}
        aiProblem=""
        onRefreshStatus={() => {}}
        onSignIn={() => {}}
        onSignOut={() => {}}
        statusOpen
        onStatusToggle={() => {}}
      />,
    );
    expect(document.body.textContent).toContain(
      "Browser storage · No AI model · add your key",
    );
    expect(document.body.textContent).toContain("No AI model available");
    expect(document.body.textContent).not.toContain("qwen3");
    expect(document.body.textContent).not.toContain("no API cost");
  });
});
