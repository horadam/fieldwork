// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApplicationsView } from "../../components/applications-view";
import { demoAnalysis, type Run, type Workspace } from "../../lib/domain";
import { seed } from "../../lib/seed";

afterEach(cleanup);
const job = seed.jobs[0];
function workspace(runs: Run[] = []): Workspace {
  return { ...structuredClone(seed), runs };
}
function completedRun(): Run {
  const output = demoAnalysis(job, seed.experience);
  output.requirements[0].status = "supported";
  output.requirements[0].evidenceIds = ["demo-e1"];
  return {
    id: "run-1",
    application_id: job.id,
    status: "completed",
    output,
    error: null,
    created_at: "2026-11-02T10:00:00.000Z",
    prompt_version: "grounded-v3",
    provider: "ollama",
    model: "qwen3:8b",
    duration_ms: 4200,
    evidence_snapshot: seed.experience,
  };
}
function setup(
  overrides: Partial<Parameters<typeof ApplicationsView>[0]> = {},
) {
  const handlers = {
    onSelectRun: vi.fn(),
    onAnalyze: vi.fn(),
    onPrepare: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onOpenTarget: vi.fn(),
    onAdd: vi.fn(),
  };
  render(
    <ApplicationsView
      workspace={workspace()}
      mode="demo"
      busy={false}
      aiReady
      runningJob={null}
      selectedRun={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("ApplicationsView", () => {
  it("offers to add an application when there are none", () => {
    const handlers = setup({ workspace: { ...workspace(), jobs: [] } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(handlers.onAdd).toHaveBeenCalled();
  });

  it("analyzes the selected job and explains a disabled button", () => {
    const handlers = setup();
    // The header and the empty Fit tab both offer it.
    const buttons = screen.getAllByRole("button", { name: "Analyze fit" });
    fireEvent.click(buttons[0]);
    expect(handlers.onAnalyze).toHaveBeenCalledWith(job);
    cleanup();
    setup({ aiReady: false });
    for (const button of screen.getAllByRole<HTMLButtonElement>("button", {
      name: "Analyze fit",
    }))
      expect(button.disabled).toBe(true);
    expect(screen.getByText(/model/i, { selector: "p" })).toBeTruthy();
  });

  it("shows coverage for a real run, with no approval step", () => {
    const run = completedRun();
    setup({ workspace: workspace([run]), selectedRun: run.id });
    expect(screen.getByText("requirements fully met")).toBeTruthy();
    expect(screen.getAllByText("Met").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
  });

  it("offers to prepare when the job has no preparation plan", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Prep plan" }));
    expect(screen.getByText("No preparation plan yet")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "It needs a completed real analysis first.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare for this job" }),
    );
    expect(handlers.onPrepare).toHaveBeenCalledWith(job);
  });

  it("shows the job's preparation plan and opens it", () => {
    const handlers = setup({
      preparation: [
        {
          targetId: "t1",
          name: "Example SaaS · Engineer",
          jobIds: [job.id],
          plan: {
            createdAt: "2026-11-05T10:00:00.000Z",
            questions: 5,
            scheduled: 8,
            remaining: 3,
          },
        },
        { targetId: "t2", name: "Other job", jobIds: ["other"], plan: null },
      ],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Prep plan" }));
    expect(screen.getByText("Example SaaS · Engineer")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "5 questions · 3 of 8 scheduled activities left",
    );
    expect(screen.queryByText("Other job")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open preparation" }));
    expect(handlers.onOpenTarget).toHaveBeenCalledWith("t1");
  });

  it("moves between detail tabs with the arrow keys", () => {
    setup();
    const fit = screen.getByRole("tab", { name: "Fit analysis" });
    fit.focus();
    fireEvent.keyDown(fit, { key: "ArrowRight" });
    expect(
      screen
        .getByRole("tab", { name: "Prep plan" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("runs actions from the ⋯ menu, including a simulated preview", () => {
    const handlers = setup();
    fireEvent.click(
      screen.getByLabelText("More actions", { selector: "summary" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Simulated preview (no model)" }),
    );
    expect(handlers.onAnalyze).toHaveBeenCalledWith(job, true);
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete application" }),
    );
    expect(handlers.onDelete).toHaveBeenCalledWith(job);
  });

  it("hides the simulated preview for signed-in accounts", () => {
    setup({ mode: "live" });
    expect(
      screen.queryByRole("menuitem", { name: /Simulated preview/ }),
    ).toBeNull();
  });
});
