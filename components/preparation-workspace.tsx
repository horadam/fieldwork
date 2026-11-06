"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { AiStatus } from "./hooks/use-ai-status";
import { CostHint } from "./ui/cost-hint";
import type { TabId } from "./shell/tabs";
import { Dialog } from "./modals/dialog";
import { ConfirmDeleteBody } from "./modals/confirm-delete";
import { TargetEditor } from "./preparation/target-editor";
import { OverflowMenu } from "./ui/overflow-menu";
import { TimingFields } from "./preparation/timing-fields";
import { DraftReview } from "./preparation/draft-review";
import { PlanPractice } from "./preparation/plan-practice";
import { EarlierTasks, PlanSchedule } from "./preparation/plan-views";
import type { Job, Workspace } from "@/lib/domain";
import {
  activateLocal,
  defaultSettings,
  emptyPreparation,
  emptyProgress,
  matchingRun,
  outdated,
  planSummaries,
  schedulePlan,
  settingsSchema,
  sourceProblems,
  targetSchema,
  validateVersion,
  validateProgress,
  type PreparationState,
  type PreparationTarget,
  type PreparationPlanVersion,
  type PreparationProgress,
  type PlanOutput,
  type PlanSettings,
  type PlanSummary,
} from "@/lib/preparation-plan";

type Props = {
  section: TabId;
  onNavigate?: (tab: TabId) => void;
  onContext?: (
    context: { name: string; next: string; targetId: string } | null,
  ) => void;
  workspace: Workspace;
  token: string;
  scope: string;
  requestedJob: string | null;
  // Opens an existing target, e.g. from an application's Prep plan tab.
  requestedTarget: string | null;
  onRequestHandled: () => void;
  // Reports each target's plan state for Applications and the Overview.
  onSummaries: (summaries: PlanSummary[]) => void;
  onGeneralChange: (general: boolean) => void;
  analyze: (job: Job) => Promise<void>;
  toggleLegacy: (id: string, done: boolean) => Promise<void>;
  // The shell reports progress and errors for analyze and toggleLegacy.
  shellBusy: boolean;
  savingTask: string | null;
  provider: string;
  ai?: AiStatus | null;
};
// Dropdown value for a single role, keyed by its application.
const roleKey = (jobId: string) => `job:${jobId}`;
const message = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;
// Roughly what plan generation sends: each job's description and latest
// analysis, plus the experience bank.
function sourceChars(workspace: Workspace, jobIds: string[]) {
  return jobIds.reduce(
    (n, id) => {
      const job = workspace.jobs.find((j) => j.id === id);
      const run = workspace.runs
        .filter((r) => r.application_id === id && r.output)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return (
        n +
        (job?.jd.length ?? 0) +
        (run ? JSON.stringify(run.output).length : 0)
      );
    },
    workspace.experience.reduce(
      (n, e) => n + e.title.length + e.body.length,
      0,
    ),
  );
}
// Notes and scores save this long after the last keystroke.
const AUTOSAVE_MS = 800;

/**
 * Preparation targets (one to three jobs), generated plan versions and their
 * progress, for the practice, study and tasks tabs. Stays mounted so drafts
 * and unsaved notes survive tab switches; account changes remount it.
 */
export function PreparationWorkspace(props: Props) {
  const { workspace, token, scope } = props;
  const [state, setState] = useState<PreparationState>(emptyPreparation);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [selected, setSelected] = useState("general");
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // The group form, if open: creating a group, or editing `target`.
  const [editor, setEditor] = useState<{
    mode: "group";
    target?: PreparationTarget;
  } | null>(null);
  const [settings, setSettings] = useState<PlanSettings>(defaultSettings);
  const [draft, setDraft] = useState<PreparationPlanVersion | null>(null);
  const [versionId, setVersionId] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [edits, setEdits] = useState<Record<string, PreparationProgress>>({});
  const [saveStatus, setSaveStatus] = useState("");
  const [savingActivity, setSavingActivity] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generating, setGenerating] = useState<AbortController | null>(null);
  const handled = useRef<string | null>(null);
  const jobTargetIds = useRef<Record<string, string>>({});
  const storageKey = "fieldwork-preparation-v1",
    selectionKey = `fieldwork-preparation-selection-${scope}`;
  const request = useMemo(() => apiClient(() => token), [token]);

  async function load() {
    setError("");
    setLoadFailed(false);
    setReady(false);
    try {
      const next: PreparationState = token
        ? await request<PreparationState>("/api/preparation")
        : JSON.parse(localStorage.getItem(storageKey) || "null") ||
          emptyPreparation();
      next.targets.forEach((target) => targetSchema.parse(target));
      next.plans.forEach(validateVersion);
      next.progress.forEach((progress) => {
        const plan = next.plans.find((p) => p.id === progress.planId);
        if (!plan) throw new Error("Saved plan missing.");
        validateProgress(progress, plan);
      });
      setState(next);
      const remembered = localStorage.getItem(selectionKey) || "general";
      // Earlier versions remembered a single role by its saved record's id.
      const saved = next.targets.find((t) => t.id === remembered);
      setSelected(
        saved
          ? saved.jobIds.length === 1
            ? roleKey(saved.jobIds[0])
            : saved.id
          : remembered.startsWith("job:") &&
              workspace.jobs.some((j) => `job:${j.id}` === remembered)
            ? remembered
            : "general",
      );
      setReady(true);
    } catch (e) {
      setError(message(e, "Could not load saved preparation."));
      setLoadFailed(true);
    }
  }
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => generating?.abort(), [generating]);
  useEffect(() => {
    props.onGeneralChange(selected === "general");
    if (ready) {
      try {
        localStorage.setItem(selectionKey, selected);
      } catch {
        setError("Could not remember preparation selection.");
      }
    }
  }, [selected, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every role is selectable. Its preparation record is saved only when a
  // plan is generated; until then the selection uses an unsaved stand-in.
  const savedRole = (jobId: string, targets = state.targets) =>
    targets.find((t) => t.jobIds.length === 1 && t.jobIds[0] === jobId);
  function resolve(key: string, targets = state.targets) {
    if (!key.startsWith("job:")) return targets.find((t) => t.id === key);
    const jobId = key.slice(4);
    const job = workspace.jobs.find((j) => j.id === jobId);
    return (
      savedRole(jobId, targets) ??
      (job && {
        id:
          jobTargetIds.current[jobId] ||
          (jobTargetIds.current[jobId] = crypto.randomUUID()),
        name: `${job.company} · ${job.role}`.slice(0, 160),
        jobIds: [jobId],
        settings: defaultSettings(),
        activeVersionId: null,
      })
    );
  }
  const target = resolve(selected);
  // A group prepares for two or three roles together.
  const isGroup = !!target && target.jobIds.length > 1;
  const groups = state.targets.filter((t) => t.jobIds.length > 1);
  // Saved roles whose application was deleted keep their plans selectable.
  const orphanRoles = state.targets.filter(
    (t) =>
      t.jobIds.length === 1 &&
      !workspace.jobs.some((j) => j.id === t.jobIds[0]),
  );
  const versions = state.plans
    .filter((p) => p.targetId === target?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const plan = versions.find(
    (p) => p.id === (versionId || target?.activeVersionId),
  );
  const readOnly = !!plan && plan.id !== target?.activeVersionId;
  const progress = plan
    ? edits[plan.id] ||
      state.progress.find((p) => p.planId === plan.id) ||
      emptyProgress(plan.id)
    : null;
  const schedule = plan
    ? schedulePlan(plan.output, plan.settings, plan.excludedActivityIds)
    : null;
  const problems = target ? sourceProblems(target, workspace) : [];

  const nextActivity = schedule?.weeks
    .flatMap((w) => w.activityIds)
    .find((id) => !progress?.done[id]);
  useEffect(() => {
    props.onContext?.(
      target
        ? {
            name: target.name,
            targetId: target.id,
            next:
              plan?.output.activities.find((a) => a.id === nextActivity)
                ?.title ||
              (plan
                ? "Review your preparation"
                : "Create your preparation plan"),
          }
        : null,
    );
  }, [selected, plan?.id, nextActivity, ready]);

  async function work(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(message(e, "Preparation operation failed."));
      return false;
    } finally {
      setBusy("");
    }
  }
  // Builds on the latest state, so overlapping saves do not undo each other.
  async function persist(
    change: (old: PreparationState) => PreparationState,
    action: string,
    value: unknown,
  ) {
    const next = change(stateRef.current);
    if (token) await request("/api/preparation", { body: { action, value } });
    else localStorage.setItem(storageKey, JSON.stringify(next));
    stateRef.current = next;
    setState(next);
  }
  async function saveTarget(value: PreparationTarget) {
    const parsed = targetSchema.parse(value);
    const existing = stateRef.current.targets.find((t) => t.id === parsed.id);
    const next = {
      ...parsed,
      activeVersionId: existing?.activeVersionId || null,
    };
    await persist(
      (old) => ({
        ...old,
        // Replace in place so the target keeps its position in the picker.
        targets: existing
          ? old.targets.map((t) => (t.id === next.id ? next : t))
          : [...old.targets, next],
      }),
      "target",
      next,
    );
    return next;
  }
  async function saveProgress(next: PreparationProgress) {
    if (!plan || readOnly) return;
    const parsed = validateProgress(next, plan);
    await persist(
      (old) => ({
        ...old,
        progress: [
          ...old.progress.filter((p) => p.planId !== parsed.planId),
          parsed,
        ],
      }),
      "progress",
      parsed,
    );
  }

  // "Prepare for this job" from Applications selects that role.
  useEffect(() => {
    if (!ready || !props.requestedJob) return;
    if (workspace.jobs.some((j) => j.id === props.requestedJob))
      choose(roleKey(props.requestedJob));
    props.onRequestHandled();
  }, [props.requestedJob, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (ready) props.onSummaries(planSummaries(state));
  }, [state, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !props.requestedTarget) return;
    const target = state.targets.find((t) => t.id === props.requestedTarget);
    if (target)
      choose(
        target.jobIds.length === 1 &&
          workspace.jobs.some((j) => j.id === target.jobIds[0])
          ? roleKey(target.jobIds[0])
          : target.id,
      );
    props.onRequestHandled();
  }, [props.requestedTarget, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(key: string, known?: PreparationTarget) {
    setSelected(key);
    setVersionId("");
    setQuestionId("");
    setDraft(null);
    setEditor(null);
    const next = known || resolve(key, stateRef.current.targets);
    if (next) setSettings(next.settings);
  }

  // Autosave practice notes and scores once typing pauses.
  useEffect(() => {
    if (!plan || readOnly) return;
    const pending = edits[plan.id];
    if (!pending) return;
    setSaveStatus("Unsaved changes…");
    const timer = setTimeout(async () => {
      try {
        setSaveStatus("Saving…");
        await saveProgress(pending);
        // Keep newer keystrokes that arrived while this save was in flight.
        setEdits((old) => {
          if (old[pending.planId] !== pending) return old;
          const rest = { ...old };
          delete rest[pending.planId];
          return rest;
        });
        setSaveStatus("Saved");
      } catch (e) {
        setSaveStatus(
          "Not saved. Your notes are kept here; keep typing to retry.",
        );
        setError(message(e, "Could not save notes."));
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [edits, plan?.id, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActivity(id: string, done: boolean) {
    if (!progress) return;
    setSavingActivity(id);
    setError("");
    try {
      await saveProgress({
        ...progress,
        done: { ...progress.done, [id]: done },
      });
    } catch (e) {
      setError(message(e, "Could not save progress."));
    } finally {
      setSavingActivity(null);
    }
  }

  async function generate() {
    if (!target) return;
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success)
      return setError(
        "Check start date, interview date, and weekly hours (0.5–40).",
      );
    const control = new AbortController();
    await work(`Generating with ${props.provider}…`, async () => {
      const saved = await saveTarget({ ...target, settings: parsed.data });
      setGenerating(control);
      try {
        const result = await request<{
          output: PlanOutput;
          metadata: PreparationPlanVersion["metadata"];
          sources: PreparationPlanVersion["sources"];
        }>("/api/preparation/generate", {
          signal: control.signal,
          body: {
            targetId: saved.id,
            settings: parsed.data,
            ...(!token
              ? {
                  target: saved,
                  workspace: {
                    jobs: workspace.jobs.filter((job) =>
                      saved.jobIds.includes(job.id),
                    ),
                    runs: saved.jobIds
                      .map((id) => matchingRun(id, workspace))
                      .filter(Boolean),
                    experience: workspace.experience,
                    tasks: [],
                  },
                }
              : {}),
          },
        });
        setDraft(
          validateVersion({
            id: crypto.randomUUID(),
            targetId: saved.id,
            createdAt: new Date().toISOString(),
            settings: parsed.data,
            sources: result.sources,
            output: result.output,
            metadata: result.metadata,
            excludedActivityIds: [],
          }),
        );
      } catch (e) {
        // Cancelling is a choice, not a failure.
        if (!control.signal.aborted) throw e;
      } finally {
        setGenerating(null);
      }
    });
  }
  async function activate() {
    if (!draft || !target) return;
    await work("Activating reviewed plan…", async () => {
      if (
        sourceProblems(target, workspace).length ||
        outdated(draft, { ...target, settings: draft.settings }, workspace)
      )
        throw new Error(
          "Sources changed during review. Generate a new version.",
        );
      await persist(
        (old) => activateLocal(old, target, draft),
        "activate",
        draft,
      );
      setSettings(draft.settings);
      setVersionId("");
      setDraft(null);
      setQuestionId("");
    });
  }
  async function deleteTarget() {
    if (!target) return;
    const done = await work(
      isGroup ? "Deleting group…" : "Deleting plan…",
      async () => {
        await persist(
          (old) => {
            const ids = old.plans
              .filter((p) => p.targetId === target.id)
              .map((p) => p.id);
            return {
              targets: old.targets.filter((t) => t.id !== target.id),
              plans: old.plans.filter((p) => p.targetId !== target.id),
              progress: old.progress.filter((p) => !ids.includes(p.planId)),
            };
          },
          "delete",
          { id: target.id },
        );
        // A role stays selected, ready for a new plan; a deleted group is gone.
        choose(isGroup ? "general" : selected);
      },
    );
    if (done) setConfirmDelete(false);
  }

  if (!["practice", "study"].includes(props.section)) return null;
  const checklist = plan &&
    progress && {
      plan,
      progress,
      disabled: !!busy || readOnly,
      savingId: savingActivity,
      onToggle: toggleActivity,
      onPractice: (ids: string[]) => {
        setQuestionId(ids[0]);
        props.onNavigate?.("practice");
      },
    };
  return (
    <section className="preparation-workspace">
      <div className="card">
        {/* Hidden while a form is open, so only one choice is in view. */}
        {!editor && (
          <div className="form">
            <label htmlFor="preparation-target">Preparing for…</label>
            <div className="actions">
              <select
                id="preparation-target"
                className="prep-select"
                value={selected}
                disabled={!!busy || !ready}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="general">General practice</option>
                {workspace.jobs.length + orphanRoles.length > 0 && (
                  <optgroup label="Roles">
                    {workspace.jobs.map((job) => (
                      <option key={job.id} value={roleKey(job.id)}>
                        {job.company} · {job.role}
                      </option>
                    ))}
                    {orphanRoles.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (deleted application)
                      </option>
                    ))}
                  </optgroup>
                )}
                {groups.length > 0 && (
                  <optgroup label="Groups">
                    {groups.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {/* Only once there's something to edit or delete. */}
              {target && (isGroup || versions.length > 0) && (
                <OverflowMenu
                  label={`Actions for ${target.name}`}
                  items={[
                    ...(isGroup
                      ? [
                          {
                            label: "Edit group",
                            onSelect: () =>
                              setEditor({ mode: "group", target }),
                            disabled: !!busy,
                          },
                        ]
                      : []),
                    {
                      label: isGroup
                        ? "Delete group"
                        : "Delete plan and progress",
                      onSelect: () => setConfirmDelete(true),
                      danger: true,
                      disabled: !!busy,
                    },
                  ]}
                />
              )}
              <button
                className="button secondary small"
                disabled={!!busy || !ready}
                onClick={() => setEditor({ mode: "group" })}
              >
                Create a group
              </button>
            </div>
            {target && isGroup && (
              <p className="tiny muted">
                Roles:{" "}
                {target.jobIds
                  .map((id) => {
                    const job = workspace.jobs.find((j) => j.id === id);
                    return job
                      ? `${job.company} · ${job.role}`
                      : "Deleted application";
                  })
                  .join(" / ")}
              </p>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {loadFailed && (
          <button
            className="button secondary small"
            onClick={() => void load()}
          >
            Reload preparation storage
          </button>
        )}
        {busy && (
          <p role="status" className="notice">
            {busy}{" "}
            {generating && (
              <button
                className="button secondary small"
                onClick={() => generating.abort()}
              >
                Cancel generation
              </button>
            )}
          </p>
        )}
        {editor?.mode === "group" && (
          <TargetEditor
            target={editor.target}
            jobs={workspace.jobs}
            busy={!!busy}
            onCancel={() => setEditor(null)}
            onSave={(value) =>
              void work("Saving group…", async () => {
                const saved = await saveTarget(value);
                choose(saved.id, saved);
              })
            }
          />
        )}
        {target && !editor && (
          <>
            {/* Shown once there's more than one version to choose from. */}
            {versions.length > 1 && (
              <div className="actions prep-toolbar">
                <label className="tiny">
                  Plan version{" "}
                  <select
                    value={plan?.id || ""}
                    onChange={(e) => {
                      setVersionId(e.target.value);
                      setQuestionId("");
                    }}
                    disabled={!!busy}
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.id === target.activeVersionId
                          ? "Active"
                          : "Previous"}{" "}
                        · {new Date(version.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {plan && outdated(plan, target, workspace) && (
              <p className="notice">
                This plan’s inputs have changed. Your current plan and progress
                remain available; generate and review a new version when ready.
              </p>
            )}
            {!plan && (
              <ol className="prep-steps" aria-label="Preparation steps">
                <li aria-current={problems.length ? "step" : undefined}>
                  1. Check requirements
                </li>
                <li
                  aria-current={!problems.length && !draft ? "step" : undefined}
                >
                  2. Set available time
                </li>
                <li aria-current={draft ? "step" : undefined}>
                  3. Review plan
                </li>
              </ol>
            )}
            {problems.map((problem) => (
              <div className="notice" key={problem.jobId}>
                <p>{problem.message}</p>
                {workspace.jobs.find((j) => j.id === problem.jobId) && (
                  <button
                    className="button secondary small"
                    disabled={!!busy || props.shellBusy}
                    onClick={() =>
                      void props.analyze(
                        workspace.jobs.find((j) => j.id === problem.jobId)!,
                      )
                    }
                  >
                    Run real analysis
                  </button>
                )}
              </div>
            ))}
            {!problems.length && (
              <details open={!plan && !draft}>
                <summary>
                  {plan
                    ? "Generate new version"
                    : "Create your preparation plan"}
                </summary>
                <p className="tiny muted">
                  Choose your time budget. You can edit the generated plan
                  before using it.
                  {plan &&
                    " Your current plan stays available until you choose its replacement."}
                </p>
                <TimingFields
                  value={settings}
                  onChange={setSettings}
                  disabled={!!busy}
                />
                <button
                  className="button"
                  disabled={!!busy || problems.length > 0}
                  onClick={() => void generate()}
                >
                  Generate {plan ? "new version" : "preparation plan"}
                </button>
                <CostHint
                  ai={props.ai ?? null}
                  step="preparation"
                  sourceChars={sourceChars(workspace, target.jobIds)}
                />
              </details>
            )}
          </>
        )}
      </div>
      {draft && target && (
        <DraftReview
          draft={draft}
          busy={!!busy}
          onChange={setDraft}
          onActivate={() => void activate()}
          onDiscard={() => setDraft(null)}
        />
      )}
      {target && plan && checklist && (
        <>
          <h2>Preparation for {target.name}</h2>
          <div className="notice">
            {readOnly ? "Previous version · read-only" : "Active plan"} ·{" "}
            {plan.settings.startDate} · {plan.metadata.provider} /{" "}
            {plan.metadata.model}
          </div>
          {props.section === "practice" && (
            <PlanPractice
              plan={plan}
              progress={checklist.progress}
              questionId={questionId}
              onQuestion={setQuestionId}
              readOnly={readOnly}
              saveStatus={saveStatus}
              onChange={(next) =>
                setEdits((old) => ({ ...old, [next.planId]: next }))
              }
            />
          )}
          {props.section === "study" && schedule && (
            <PlanSchedule {...checklist} schedule={schedule} />
          )}
        </>
      )}
      {target && !plan && !draft && !problems.length && (
        <p className="notice">
          Your questions and schedule will appear here after you review and
          start your plan.
        </p>
      )}
      {target && props.section === "study" && (
        <EarlierTasks
          target={target}
          workspace={workspace}
          savingTask={props.savingTask}
          onToggle={(id, done) => void props.toggleLegacy(id, done)}
        />
      )}
      {confirmDelete && target && (
        <Dialog
          title={isGroup ? "Delete this group?" : "Delete this plan?"}
          close={() => {
            if (!busy) setConfirmDelete(false);
          }}
        >
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <ConfirmDeleteBody
            busy={!!busy}
            confirmLabel={
              isGroup ? "Delete group and progress" : "Delete plan and progress"
            }
            consequence={
              isGroup
                ? "This deletes the group, all its plan versions, and their progress. Applications and earlier analysis tasks remain."
                : "This deletes this role's plan versions and their progress. The role stays in the list, ready for a new plan."
            }
            onConfirm={() => void deleteTarget()}
            onCancel={() => setConfirmDelete(false)}
          />
        </Dialog>
      )}
    </section>
  );
}
