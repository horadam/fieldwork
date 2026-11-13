// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ApplicationsView,
  analysisRunMeta,
  fitLabel,
} from "../../components/applications-view";
import {
  demoAnalysis,
  type AnalysisRun,
  type Workspace,
} from "../../lib/domain";
import { seed } from "../../lib/seed";

afterEach(cleanup);
const job = seed.jobs[0];
function workspace(analysisRuns: AnalysisRun[] = []): Workspace {
  return { ...structuredClone(seed), runs: analysisRuns };
}
function completedAnalysisRun(): AnalysisRun {
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
    onSelectAnalysisRun: vi.fn(),
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
      analyzingJobId={null}
      selectedAnalysisRunId={null}
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
    // Only the empty Fit tab offers it; the header shows status instead.
    const buttons = screen.getAllByRole("button", { name: "Analyze fit" });
    expect(buttons).toHaveLength(1);
    expect(screen.getAllByText("Not analyzed").length).toBeGreaterThan(0);
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

  it("shows coverage for a real analysis, with no approval step", () => {
    const analysisRun = completedAnalysisRun();
    setup({
      workspace: workspace([analysisRun]),
      selectedAnalysisRunId: analysisRun.id,
    });
    expect(screen.getByText("requirements fully met")).toBeTruthy();
    expect(screen.getAllByText("Met").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
  });

  it("offers analysis, not preparation, before a current analysis exists", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Prep plan" }));
    expect(screen.getByText("No preparation plan yet")).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Run a current real analysis first.",
    );
    expect(
      screen.queryByRole("button", { name: "Prepare for this job" }),
    ).toBeNull();
    const buttons = screen.getAllByRole("button", { name: "Analyze fit" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(handlers.onAnalyze).toHaveBeenCalledWith(job);
  });

  it("offers to prepare once a current analysis exists", () => {
    const analysisRun = completedAnalysisRun();
    analysisRun.jd_snapshot = job.jd;
    const handlers = setup({ workspace: workspace([analysisRun]) });
    fireEvent.click(screen.getByRole("tab", { name: "Prep plan" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare for this job" }),
    );
    expect(handlers.onPrepare).toHaveBeenCalledWith(job);
  });

  it("explains why a changed experience bank needs a new analysis", () => {
    const analysisRun = completedAnalysisRun();
    analysisRun.jd_snapshot = job.jd;
    const data = workspace([analysisRun]);
    data.experience[0].body += " New experience";
    setup({ workspace: data });
    expect(
      screen.getByText(/Your experience changed since this analysis/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Re-run fit analysis" }),
    ).toBeTruthy();
  });

  it("marks unanalyzed jobs with a chip and lists analysis facts separately", () => {
    expect(fitLabel(undefined)).toBeNull();
    const analysisRun = completedAnalysisRun();
    expect(analysisRunMeta(analysisRun)).toEqual([
      "ollama",
      "qwen3:8b",
      expect.any(String),
      "4.2 s",
    ]);
    expect(
      analysisRunMeta({
        ...analysisRun,
        provider: "simulated",
        model: "none",
      }).slice(0, 2),
    ).toEqual(["Simulated preview", "no model called"]);
    setup();
    const row = screen.getByRole("button", { pressed: true });
    expect(row.querySelector(".chip")?.textContent).toBe("Not analyzed");
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
    expect(document.body.textContent).toContain("3 of 8 activities left");
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
    const handlers = setup({ aiReady: false });
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

  it("hides the simulated preview when a model is ready", () => {
    setup();
    fireEvent.click(
      screen.getByLabelText("More actions", { selector: "summary" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: /Simulated preview/ }),
    ).toBeNull();
  });

  it("hides the simulated preview for signed-in accounts", () => {
    setup({ mode: "live" });
    expect(
      screen.queryByRole("menuitem", { name: /Simulated preview/ }),
    ).toBeNull();
  });
});

it("advances a fresh analysis to plan creation", () => {
  const analysisRun = completedAnalysisRun();
  analysisRun.jd_snapshot = job.jd;
  const handlers = setup({ workspace: workspace([analysisRun]) });
  fireEvent.click(
    screen.getByRole("button", { name: "Create preparation plan" }),
  );
  expect(handlers.onPrepare).toHaveBeenCalledWith(job);
});
