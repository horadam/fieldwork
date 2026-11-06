// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RecordFormBody } from "../../components/modals/record-form";
import { AuthFormBody } from "../../components/modals/auth-form";
import { TargetEditor } from "../../components/preparation/target-editor";
import { RolePicker } from "../../components/preparation/role-picker";
import { DraftReview } from "../../components/preparation/draft-review";
import { seed } from "../../lib/seed";
import { planSources } from "../../lib/preparation-plan";
import { target, version, workspace } from "../preparation-fixtures";

afterEach(cleanup);

describe("record form", () => {
  it("cancels without saving", () => {
    const onSave = vi.fn(),
      onCancel = vi.fn();
    render(
      <RecordFormBody
        form={{ entity: "experience" }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("explains invalid input instead of throwing", () => {
    const onSave = vi.fn();
    const { container } = render(
      <RecordFormBody
        form={{ entity: "experience" }}
        busy={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Experience title"), {
      target: { value: "Title" },
    });
    fireEvent.change(screen.getByLabelText("User-confirmed details"), {
      target: { value: "short" },
    });
    // jsdom does not enforce minLength, so this reaches the schema check.
    fireEvent.submit(container.querySelector("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("10–5,000");
  });
});

describe("sign-in form", () => {
  it("shows the email confirmation step as information, not an error", async () => {
    render(
      <AuthFormBody
        available
        busy={false}
        onSubmit={async () => "confirm-email"}
      />,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Check your email",
      ),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers sign-in only on an invite-only deployment", async () => {
    const onSubmit = vi.fn(async () => "signed-in" as const);
    render(
      <AuthFormBody
        available
        signupsOpen={false}
        busy={false}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(document.body.textContent).toContain("invite-only");
    expect(document.body.textContent).toContain("your own OpenAI key");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        { email: "person@example.com", password: "long-enough" },
        false,
      ),
    );
  });
});

describe("target editor", () => {
  it("edits its own copy of the settings, so cancel changes nothing", () => {
    const existing = { ...target, jobIds: [seed.jobs[0].id] };
    const onSave = vi.fn(),
      onCancel = vi.fn();
    render(
      <TargetEditor
        target={existing}
        jobs={seed.jobs}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.change(screen.getByLabelText("Available hours per week"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(existing.settings.hoursPerWeek).toBe(12);
  });

  it("requires two or three roles for a group", () => {
    const onSave = vi.fn();
    render(
      <TargetEditor
        jobs={seed.jobs}
        busy={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Create a group" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Group name"), {
      target: { value: "Group" },
    });
    fireEvent.click(
      screen.getByLabelText(`${seed.jobs[0].company} · ${seed.jobs[0].role}`),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("two or three");
  });
});

describe("role picker", () => {
  it("starts preparing for the chosen role", () => {
    const jobs = [
      seed.jobs[0],
      { ...seed.jobs[0], id: "job-2", company: "Other", role: "Engineer" },
    ];
    const onPick = vi.fn();
    render(
      <RolePicker
        jobs={jobs}
        busy={false}
        onPick={onPick}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "job-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start preparing" }));
    expect(onPick).toHaveBeenCalledWith("job-2");
  });

  it("asks for an application when there are none", () => {
    render(
      <RolePicker
        jobs={[]}
        busy={false}
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.body.textContent).toContain("Add an application first.");
    expect(
      (
        screen.getByRole("button", {
          name: "Start preparing",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("draft review", () => {
  it("names each activity for assistive technology", async () => {
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
    expect(
      screen.getByRole("group", {
        name: `Activity 1: ${draft.output.activities[0].title}`,
      }),
    ).toBeTruthy();
  });

  it("lists links removed from the model's reply", async () => {
    const draft = version(await planSources(target, workspace()));
    draft.metadata.repairs = [
      "Removed 1 link to requirements that don't exist.",
    ];
    render(
      <DraftReview
        draft={draft}
        busy={false}
        onChange={() => {}}
        onActivate={() => {}}
        onDiscard={() => {}}
      />,
    );
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("links were removed");
    expect(notice.textContent).toContain(
      "Removed 1 link to requirements that don't exist.",
    );
  });
});
