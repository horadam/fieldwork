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
        onSetUpKey={() => {}}
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

describe("status panel", () => {
  // jsdom has no IntersectionObserver; this one reports the pill as visible.
  class VisibleObserver {
    constructor(private report: IntersectionObserverCallback) {}
    observe() {
      this.report(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect() {}
  }
  const ai = {
    provider: "ollama" as const,
    model: "qwen3:8b",
    ready: true,
    message: "",
    allowed: true,
  };
  function open() {
    vi.stubGlobal("IntersectionObserver", VisibleObserver);
    const handlers = { onStatusToggle: vi.fn(), onSetUpKey: vi.fn() };
    render(
      <>
        <Topbar
          section="Overview"
          mode="demo"
          email=""
          ai={ai}
          aiProblem=""
          onRefreshStatus={() => {}}
          onSignIn={() => {}}
          onSignOut={() => {}}
          statusOpen
          {...handlers}
        />
        <p>Elsewhere on the page</p>
      </>,
    );
    return handlers;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("stays open while used, and closes on an outside click", () => {
    const handlers = open();
    fireEvent.pointerDown(screen.getByText(/Refresh model status/));
    expect(handlers.onStatusToggle).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText("Elsewhere on the page"));
    expect(handlers.onStatusToggle).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", () => {
    const handlers = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handlers.onStatusToggle).toHaveBeenCalledWith(false);
  });

  it("opens key setup in a dialog instead of inline", () => {
    const handlers = open();
    fireEvent.click(
      screen.getByRole("button", { name: "Use your own OpenAI key" }),
    );
    expect(handlers.onSetUpKey).toHaveBeenCalled();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  });
});
