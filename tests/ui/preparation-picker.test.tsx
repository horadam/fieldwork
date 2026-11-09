// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { PreparationWorkspace } from "../../components/preparation-workspace";
import { defaultSettings, planSources } from "../../lib/preparation-plan";
import {
  target as fixtureTarget,
  version,
  workspace as fixtureWorkspace,
} from "../preparation-fixtures";
import { seed } from "../../lib/seed";

const jobs = [
  seed.jobs[0],
  { ...seed.jobs[0], id: "job-2", company: "Other", role: "Engineer" },
];
const role = {
  id: "a1111111-1111-4111-8111-111111111111",
  name: "Example role",
  jobIds: [jobs[0].id],
  settings: defaultSettings(),
  activeVersionId: null,
};
const group = {
  ...role,
  id: "b2222222-2222-4222-8222-222222222222",
  name: "Two roles",
  jobIds: [jobs[0].id, "job-2"],
};

function setup(selected: string) {
  localStorage.setItem(
    "fieldwork-preparation-v1",
    JSON.stringify({ targets: [role, group], plans: [], progress: [] }),
  );
  localStorage.setItem("fieldwork-preparation-selection-browser", selected);
  render(
    <PreparationWorkspace
      section="practice"
      workspace={{ ...structuredClone(seed), jobs }}
      token=""
      scope="browser"
      requestedJob={null}
      requestedTarget={null}
      onRequestHandled={() => {}}
      onSummaries={() => {}}
      onGeneralChange={() => {}}
      analyze={async () => {}}
      toggleLegacy={async () => {}}
      shellBusy={false}
      savingTask={null}
      provider="ollama · qwen3:8b"
    />,
  );
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Preparing for…", () => {
  it("lists every role, with nothing to delete before a plan exists", async () => {
    setup("general");
    const select = (await screen.findByLabelText(
      "Preparing for…",
    )) as HTMLSelectElement;
    const roles = select.querySelector('optgroup[label="Roles"]')!;
    expect([...roles.querySelectorAll("option")].map((o) => o.value)).toEqual(
      jobs.map((j) => `job:${j.id}`),
    );
    fireEvent.change(select, { target: { value: "job:job-2" } });
    expect(screen.queryByLabelText(/Actions for/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove|Delete/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Run real analysis" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Available hours per week")).toBeNull();
    // Nothing is saved just by choosing a role.
    expect(
      JSON.parse(localStorage.getItem("fieldwork-preparation-v1")!).targets,
    ).toHaveLength(2);
  });

  it("remembers a role chosen by its saved record in earlier versions", async () => {
    setup(role.id);
    const select = (await screen.findByLabelText(
      "Preparing for…",
    )) as HTMLSelectElement;
    expect(select.value).toBe(`job:${jobs[0].id}`);
  });

  it("offers editing and deleting for a group", async () => {
    setup(group.id);
    fireEvent.click(
      (await screen.findAllByLabelText("Actions for Two roles"))[0],
    );
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Edit group",
      "Delete group",
    ]);
    expect(screen.getByLabelText("Roles in this group")).toBeTruthy();
  });

  it("groups the dropdown into roles and groups", async () => {
    setup("general");
    const select = (await screen.findByLabelText(
      "Preparing for…",
    )) as HTMLSelectElement;
    expect(
      [...select.querySelectorAll("optgroup")].map((g) => g.label),
    ).toEqual(["Roles", "Groups"]);
    expect(screen.queryByLabelText(/Actions for/)).toBeNull();
  });

  it("hides the dropdown while creating a group", async () => {
    setup("general");
    expect(
      screen.queryByRole("button", { name: "Prepare for a role" }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a group" }),
    );
    expect(screen.queryByLabelText("Preparing for…")).toBeNull();
    expect(screen.getByRole("heading", { name: "Create a group" }));
  });

  it("offers deleting a role's plan once it has one", async () => {
    const plan = version(await planSources(fixtureTarget, fixtureWorkspace()));
    localStorage.setItem(
      "fieldwork-preparation-v1",
      JSON.stringify({
        targets: [{ ...fixtureTarget, activeVersionId: plan.id }],
        plans: [plan],
        progress: [],
      }),
    );
    localStorage.setItem(
      "fieldwork-preparation-selection-browser",
      "job:job-a",
    );
    render(
      <PreparationWorkspace
        section="practice"
        workspace={fixtureWorkspace()}
        token=""
        scope="browser"
        requestedJob={null}
        requestedTarget={null}
        onRequestHandled={() => {}}
        onSummaries={() => {}}
        onGeneralChange={() => {}}
        analyze={async () => {}}
        toggleLegacy={async () => {}}
        shellBusy={false}
        savingTask={null}
        provider="ollama · qwen3:8b"
      />,
    );
    fireEvent.click((await screen.findAllByLabelText(/^Actions for /))[0]);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Delete plan and progress",
    ]);
    localStorage.setItem(
      "fieldwork-interviews-v1",
      JSON.stringify([{ planId: plan.id }, { planId: "another-plan" }]),
    );
    fireEvent.click(items[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete plan and progress" }),
    );
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("fieldwork-interviews-v1")!),
      ).toEqual([{ planId: "another-plan" }]),
    );
  });
});
