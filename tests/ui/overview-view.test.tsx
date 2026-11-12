// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OverviewView } from "../../components/views/overview-view";
import { seed } from "../../lib/seed";

afterEach(cleanup);

it("summarizes every stage and counts only plan activities", () => {
  const data = {
    ...structuredClone(seed),
    tasks: [
      { id: "t", run_id: "r", title: "Old task", detail: "", done: false },
    ],
  };
  render(
    <OverviewView
      data={data}
      planSummaries={[
        {
          targetId: "t1",
          name: "Target",
          jobIds: [],
          plan: {
            createdAt: "2026-11-05T10:00:00.000Z",
            questions: 5,
            scheduled: 8,
            remaining: 3,
          },
        },
      ]}
      studyDone={0}
      studyTotal={4}
      onNavigate={() => {}}
    />,
  );
  const text = document.body.textContent!;
  expect(text).toContain(`${seed.experience.length} experience records`);
  expect(text).toMatch(
    new RegExp(
      `0 of ${seed.jobs.length} applications? with a current analysis`,
    ),
  );
  expect(text).toContain("1 active plan");
  // Legacy tasks belong to the Earlier tasks view, not this count.
  expect(
    screen.getByText("Plan activities left").previousSibling?.textContent,
  ).toBe("3");
});
