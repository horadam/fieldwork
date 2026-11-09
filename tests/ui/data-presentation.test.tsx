// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Meta, dateRange } from "../../components/ui/meta";
import { SourceList } from "../../components/preparation/source-list";
import { ExperienceView } from "../../components/views/experience-view";
import { DraftReview } from "../../components/preparation/draft-review";
import { ActivityChecklist } from "../../components/preparation/activity-checklist";
import { emptyProgress, planSources } from "../../lib/preparation-plan";
import { target, version, workspace } from "../preparation-fixtures";

afterEach(cleanup);

describe("metadata row", () => {
  it("shows each fact as its own item and skips empty ones", () => {
    render(<Meta items={["60 min", "", null, "Priority 1"]} />);
    const row = document.querySelector(".meta")!;
    expect([...row.children].map((c) => c.textContent)).toEqual([
      "60 min",
      "Priority 1",
    ]);
  });

  it("formats date ranges the same in every time zone", () => {
    expect(dateRange("2026-11-06", "2026-11-12")).toMatch(/Nov 6 – Nov 12/);
    expect(dateRange("2026-11-06", "2026-11-06")).toMatch(/^Nov 6$/);
  });
});

describe("requirement lists", () => {
  it("lists covered requirements under their company", async () => {
    const plan = version(await planSources(target, workspace()));
    const req = plan.sources[0].analysis.requirements;
    render(
      <SourceList
        refs={req.slice(0, 2).map((r) => ({
          jobId: "job-a",
          requirementId: r.id,
        }))}
        plan={plan}
      />,
    );
    expect(screen.getByText("Covers · Example")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      req.slice(0, 2).map((r) => r.requirement),
    );
  });
});

describe("experience cards", () => {
  it("shows imported dates as metadata and accomplishments as a list", () => {
    render(
      <ExperienceView
        experience={[
          {
            id: "e1",
            title: "Fabric · Senior Software Engineer",
            body: "07/2023 – 04/2024\nBuilt serverless APIs.\nLed a migration to React.",
            provenance: {
              organization: "Fabric",
              role: "Senior Software Engineer",
              dates: "07/2023 – 04/2024",
            },
          } as never,
        ]}
        busy={false}
        onAdd={() => {}}
        onImport={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    const card = screen.getByRole("article");
    expect(card.querySelector(".meta")!.textContent).toBe("07/2023 – 04/2024");
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Built serverless APIs.", "Led a migration to React."]);
  });
});

describe("plan activities and schedule", () => {
  it("separates an activity's facts, practice questions and requirements", async () => {
    const plan = version(await planSources(target, workspace()));
    render(
      <ActivityChecklist
        plan={plan}
        ids={["a1"]}
        progress={emptyProgress(plan.id)}
        disabled={false}
        onToggle={() => {}}
      />,
    );
    expect(document.querySelector(".chip")!.textContent).toBe(
      "Question practice",
    );
    expect(screen.getByText("Practice questions")).toBeTruthy();
    expect(screen.getByText("Covers · Example")).toBeTruthy();
  });

  it("previews each week as its own list with minutes", async () => {
    const draft = version(await planSources(target, workspace()));
    render(
      <DraftReview
        draft={draft}
        busy={false}
        onChange={() => {}}
        onActivate={() => {}}
        onDiscard={() => {}}
      />,
    );
    const week = screen.getByRole("heading", { name: "Week 1" }).parentElement!
      .parentElement!;
    expect(
      within(week)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(draft.output.activities.map((a) => `${a.title}${a.minutes} min`));
    expect(screen.getByText("Nothing deferred.")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});
