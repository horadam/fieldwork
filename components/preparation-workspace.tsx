"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import type { TabId } from "./shell/tabs";
import type { Job, Workspace } from "@/lib/domain";
import {
  activateLocal,
  defaultSettings,
  emptyPreparation,
  emptyProgress,
  matchingRun,
  outdated,
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
} from "@/lib/preparation-plan";

type Props = {
  section: TabId;
  workspace: Workspace;
  token: string;
  scope: string;
  requestedJob: string | null;
  onRequestHandled: () => void;
  onGeneralChange: (general: boolean) => void;
  analyze: (job: Job) => Promise<void>;
  toggleLegacy: (id: string, done: boolean) => Promise<void>;
  // The shell reports progress and errors for analyze and toggleLegacy.
  shellBusy: boolean;
  savingTask: string | null;
  provider: string;
};
const rubric = ["Clarity", "Correctness", "Depth", "Tradeoffs", "Ownership"];
const activityTypes = [
  "study",
  "coding_design",
  "story_rehearsal",
  "question_practice",
];
export function PreparationWorkspace(props: Props) {
  const { workspace, token, scope } = props;
  const [state, setState] = useState<PreparationState>(emptyPreparation),
    [selected, setSelected] = useState("general"),
    [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [editor, setEditor] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [members, setMembers] = useState<string[]>([]),
    [settings, setSettings] = useState<PlanSettings>(defaultSettings);
  const [draft, setDraft] = useState<PreparationPlanVersion | null>(null),
    [versionId, setVersionId] = useState(""),
    [questionId, setQuestionId] = useState("");
  const [edits, setEdits] = useState<Record<string, PreparationProgress>>({});
  const [jobFilter, setJobFilter] = useState(""),
    [typeFilter, setTypeFilter] = useState(""),
    [doneFilter, setDoneFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const controller = useRef<AbortController | null>(null),
    handled = useRef<string | null>(null);
  const newTargetId = useRef(crypto.randomUUID());
  const jobTargetIds = useRef<Record<string, string>>({});
  const storageKey = "fieldwork-preparation-v1",
    selectionKey = `fieldwork-preparation-selection-${scope}`;
  const request = useMemo(() => apiClient(() => token), [token]);
  async function load() {
    setError("");
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
      setSelected(
        next.targets.some((t) => t.id === remembered) ? remembered : "general",
      );
      setReady(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load saved preparation.",
      );
    }
  }
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, []); // Account changes remount this component.
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
  const target = state.targets.find((t) => t.id === selected);
  const versions = state.plans
    .filter((p) => p.targetId === selected)
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
  const draftSchedule =
    draft && settingsSchema.safeParse(draft.settings).success
      ? schedulePlan(draft.output, draft.settings, draft.excludedActivityIds)
      : null;
  const selectedQuestion =
    plan?.output.questions.find((q) => q.id === questionId) ||
    plan?.output.questions[0];
  const problems = target ? sourceProblems(target, workspace) : [];
  async function work(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Preparation operation failed.",
      );
    } finally {
      setBusy("");
    }
  }
  async function persist(
    next: PreparationState,
    action: string,
    value: unknown,
  ) {
    if (token) await request("/api/preparation", { body: { action, value } });
    else localStorage.setItem(storageKey, JSON.stringify(next));
    setState(next);
  }
  async function saveTarget(value: PreparationTarget) {
    const parsed = targetSchema.parse(value),
      existing = state.targets.find((t) => t.id === parsed.id);
    const next = {
      ...parsed,
      activeVersionId: existing?.activeVersionId || null,
    };
    await persist(
      {
        ...state,
        targets: [...state.targets.filter((t) => t.id !== parsed.id), next],
      },
      "target",
      next,
    );
    return next;
  }
  useEffect(() => {
    if (!ready || !props.requestedJob || handled.current === props.requestedJob)
      return;
    const id = props.requestedJob;
    handled.current = id;
    const job = workspace.jobs.find((j) => j.id === id);
    if (!job) {
      handled.current = null;
      props.onRequestHandled();
      return;
    }
    const existing = state.targets.find(
      (t) => t.jobIds.length === 1 && t.jobIds[0] === id,
    );
    void work("Opening preparation target…", async () => {
      const next =
        existing ||
        (await saveTarget({
          id:
            jobTargetIds.current[id] ||
            (jobTargetIds.current[id] = crypto.randomUUID()),
          name: `${job.company} · ${job.role}`.slice(0, 160),
          jobIds: [id],
          settings: defaultSettings(),
          activeVersionId: null,
        }));
      setSelected(next.id);
      setSettings(next.settings);
      setVersionId("");
    }).finally(() => {
      props.onRequestHandled();
      handled.current = null;
    });
  }, [props.requestedJob, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  function choose(id: string) {
    setSelected(id);
    setVersionId("");
    setQuestionId("");
    setDraft(null);
    setEditor(false);
    setConfirmDelete(false);
    setJobFilter("");
    const next = state.targets.find((t) => t.id === id);
    if (next) setSettings(next.settings);
  }
  useEffect(() => {
    if (target) setSettings(target.settings);
  }, [target?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  function editTarget(value?: PreparationTarget) {
    newTargetId.current = crypto.randomUUID();
    setEditor(true);
    setEditingId(value?.id || null);
    setName(value?.name || "");
    setMembers(value?.jobIds || []);
    setSettings(value?.settings || defaultSettings());
    setDraft(null);
  }
  // editTarget replaced the shared settings with the edited target's; put the
  // selected target's settings back so the generate form stays accurate.
  function cancelEdit() {
    setEditor(false);
    if (target) setSettings(target.settings);
  }
  async function generate() {
    if (!target) return;
    await work(`Generating with ${props.provider}…`, async () => {
      const parsed = settingsSchema.safeParse(settings);
      if (!parsed.success)
        throw new Error(
          "Check start date, interview date, and weekly hours (0.5–40).",
        );
      const saved = await saveTarget({ ...target, settings: parsed.data });
      const control = new AbortController();
      controller.current = control;
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
      } finally {
        controller.current = null;
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
      const next = activateLocal(state, target, draft);
      await persist(next, "activate", draft);
      setSettings(draft.settings);
      setVersionId("");
      setDraft(null);
      setQuestionId("");
    });
  }
  function editProgress(next: PreparationProgress) {
    setEdits((old) => ({ ...old, [next.planId]: next }));
  }
  async function saveProgress(next: PreparationProgress) {
    if (!plan || readOnly) return;
    await work("Saving progress…", async () => {
      const parsed = validateProgress(next, plan);
      await persist(
        {
          ...state,
          progress: [
            ...state.progress.filter((p) => p.planId !== plan.id),
            parsed,
          ],
        },
        "progress",
        parsed,
      );
      setEdits((old) => {
        const next = { ...old };
        delete next[plan.id];
        return next;
      });
    });
  }
  function sourceLabels(
    refs: { jobId: string; requirementId: string }[],
    sourcePlan = plan,
  ) {
    return refs
      .map((ref) => {
        const source = sourcePlan?.sources.find((s) => s.jobId === ref.jobId);
        const requirement = source?.analysis.requirements.find(
          (r) => r.id === ref.requirementId,
        );
        return `${source?.company || "Job"} · ${requirement?.requirement || ref.requirementId}`;
      })
      .join(" / ");
  }
  function checklist(ids: string[]) {
    return ids.map((id) => {
      const activity = plan!.output.activities.find((a) => a.id === id)!;
      return (
        <label className="check" key={id}>
          <input
            type="checkbox"
            disabled={!!busy || readOnly}
            checked={progress?.done[id] || false}
            onChange={(e) =>
              void saveProgress({
                ...progress!,
                done: { ...progress!.done, [id]: e.target.checked },
              })
            }
          />
          <div>
            <strong>{activity.title}</strong>
            <p className="tiny muted">
              {activity.minutes} min · {activity.type.replaceAll("_", " ")} ·
              Priority {activity.priority}
            </p>
            <p>{activity.detail}</p>
            <p className="tiny muted">{sourceLabels(activity.refs)}</p>
            {activity.questionIds.length > 0 && (
              <p className="tiny">
                Practice questions:{" "}
                {activity.questionIds
                  .map(
                    (id) =>
                      plan!.output.questions.find((q) => q.id === id)?.text,
                  )
                  .join(" / ")}
              </p>
            )}
          </div>
        </label>
      );
    });
  }
  function timing(value: PlanSettings, change: (next: PlanSettings) => void) {
    const valid = settingsSchema.safeParse(value);
    const budget = valid.success
      ? schedulePlan({ summary: "", questions: [], activities: [] }, value)
      : null;
    return (
      <div className="form prep-timing">
        <div className="twocol">
          <label>
            Start date
            <input
              type="date"
              value={value.startDate}
              disabled={!!busy}
              onChange={(e) => change({ ...value, startDate: e.target.value })}
            />
          </label>
          <label>
            Preparation horizon
            <select
              value={value.duration}
              disabled={!!busy}
              onChange={(e) =>
                change({
                  ...value,
                  duration: e.target.value as PlanSettings["duration"],
                  deadline:
                    e.target.value === "deadline"
                      ? value.deadline || value.startDate
                      : null,
                })
              }
            >
              <option value="week">One week</option>
              <option value="two_weeks">Two weeks</option>
              <option value="deadline">Specific interview date</option>
            </select>
          </label>
        </div>
        {value.duration === "deadline" && (
          <label>
            Interview date (included)
            <input
              type="date"
              min={value.startDate}
              value={value.deadline || ""}
              disabled={!!busy}
              onChange={(e) => change({ ...value, deadline: e.target.value })}
            />
          </label>
        )}
        <label>
          Available hours per week
          <input
            type="number"
            min={0.5}
            max={40}
            step={0.5}
            value={value.hoursPerWeek}
            disabled={!!busy}
            onChange={(e) =>
              change({ ...value, hoursPerWeek: Number(e.target.value) })
            }
          />
        </label>
        <p className="tiny muted">
          {budget
            ? `${budget.capacity} minutes available across ${budget.weeks.length} week(s). Partial weeks are prorated.`
            : "Choose valid dates and 0.5–40 hours/week."}
        </p>
      </div>
    );
  }
  if (!["practice", "study", "tasks"].includes(props.section)) return null;
  return (
    <section className="preparation-workspace">
      <div className="card">
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
              {state.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="button secondary small"
              disabled={!!busy || !ready}
              onClick={() => {
                const picker = document.getElementById(
                  "preparation-target",
                ) as HTMLSelectElement | null;
                picker?.focus();
                try {
                  picker?.showPicker?.();
                } catch {
                  /* Keyboard selection remains available. */
                }
              }}
            >
              Change target
            </button>
            <button
              className="button secondary small"
              disabled={!!busy || !ready}
              onClick={() => editTarget()}
            >
              Create preparation group
            </button>
          </div>
          {target && (
            <p className="tiny muted">
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
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {!ready && (
          <button
            className="button secondary small"
            onClick={() => void load()}
          >
            Reload preparation storage
          </button>
        )}
        {busy && (
          <p role="status">
            {busy}{" "}
            {controller.current && (
              <button
                className="button secondary small"
                onClick={() => controller.current?.abort()}
              >
                Cancel generation
              </button>
            )}
          </p>
        )}
        {editor && (
          <form
            className="form prep-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void work("Saving target…", async () => {
                if (!members.length || members.length > 3)
                  throw new Error("Choose one to three jobs.");
                const value = await saveTarget({
                  id: editingId || newTargetId.current,
                  name,
                  jobIds: members,
                  settings,
                  activeVersionId: null,
                });
                choose(value.id);
                setSettings(value.settings);
              });
            }}
          >
            <h3>{editingId ? "Edit target" : "Create preparation group"}</h3>
            <label>
              Target name
              <input
                required
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!busy}
              />
            </label>
            <fieldset>
              <legend>Choose one to three applications</legend>
              {members
                .filter((id) => !workspace.jobs.some((j) => j.id === id))
                .map((id) => (
                  <label className="prep-member" key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        setMembers(members.filter((member) => member !== id))
                      }
                    />
                    Deleted application · deselect to repair
                  </label>
                ))}
              {workspace.jobs.map((job) => (
                <label className="prep-member" key={job.id}>
                  <input
                    type="checkbox"
                    disabled={
                      !!busy ||
                      (!members.includes(job.id) && members.length >= 3)
                    }
                    checked={members.includes(job.id)}
                    onChange={(e) =>
                      setMembers(
                        e.target.checked
                          ? [...members, job.id]
                          : members.filter((id) => id !== job.id),
                      )
                    }
                  />
                  {job.company} · {job.role}
                </label>
              ))}
            </fieldset>
            {timing(settings, setSettings)}
            <div className="actions">
              <button className="button" disabled={!!busy}>
                Save target
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {target && !editor && (
          <>
            <div className="actions prep-toolbar">
              <button
                className="button secondary small"
                disabled={!!busy}
                onClick={() => editTarget(target)}
              >
                Edit target
              </button>
              <button
                className="button danger small"
                disabled={!!busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete target
              </button>
              {versions.length > 0 && (
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
                    {versions.map((version, i) => (
                      <option key={version.id} value={version.id}>
                        {version.id === target.activeVersionId
                          ? "Active"
                          : "Previous"}{" "}
                        · {new Date(version.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {confirmDelete && (
              <div className="notice">
                <p>
                  Delete this target, all its plan versions, and progress?
                  Applications and earlier analysis tasks remain.
                </p>
                <div className="actions">
                  <button
                    className="button danger small"
                    disabled={!!busy}
                    onClick={() =>
                      void work("Deleting target…", async () => {
                        const ids = state.plans
                          .filter((p) => p.targetId === target.id)
                          .map((p) => p.id);
                        await persist(
                          {
                            targets: state.targets.filter(
                              (t) => t.id !== target.id,
                            ),
                            plans: state.plans.filter(
                              (p) => p.targetId !== target.id,
                            ),
                            progress: state.progress.filter(
                              (p) => !ids.includes(p.planId),
                            ),
                          },
                          "delete",
                          { id: target.id },
                        );
                        choose("general");
                      })
                    }
                  >
                    Delete target and progress
                  </button>
                  <button
                    className="button secondary small"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {plan && outdated(plan, target, workspace) && (
              <p className="notice">
                This plan’s inputs have changed. Your current plan and progress
                remain available; generate and review a new version when ready.
              </p>
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
            <details open={!plan && !draft}>
              <summary>
                {plan ? "Generate new version" : "Create your preparation plan"}
              </summary>
              <p className="tiny muted">
                One explicit call with {props.provider}. Review before
                activation. Existing plans are never replaced automatically.
              </p>
              {timing(settings, setSettings)}
              <button
                className="button"
                disabled={!!busy || problems.length > 0}
                onClick={() => void generate()}
              >
                Generate {plan ? "new version" : "preparation plan"}
              </button>
            </details>
          </>
        )}
      </div>
      {draft && target && (
        <section className="card prep-review">
          <fieldset
            disabled={!!busy}
            className="prep-review-fields"
            aria-label="Review preparation plan"
          >
            <h2>Review your preparation plan</h2>
            <p>{draft.output.summary}</p>
            <p className="tiny muted">
              {draft.metadata.provider} · {draft.metadata.model} ·{" "}
              {draft.metadata.promptVersion} · {draft.metadata.durationMs} ms
            </p>
            {timing(draft.settings, (value) =>
              setDraft({ ...draft, settings: value }),
            )}
            <h3>Questions and suggested outlines</h3>
            {draft.output.questions.map((q, index) => (
              <details key={q.id}>
                <summary>{q.text}</summary>
                <div className="form">
                  <label>
                    Question
                    <textarea
                      value={q.text}
                      maxLength={700}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          output: {
                            ...draft.output,
                            questions: draft.output.questions.map((item, i) =>
                              i === index
                                ? { ...item, text: e.target.value }
                                : item,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Suggested answer outline
                    <textarea
                      value={q.outline}
                      maxLength={1800}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          output: {
                            ...draft.output,
                            questions: draft.output.questions.map((item, i) =>
                              i === index
                                ? { ...item, outline: e.target.value }
                                : item,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <p className="tiny muted">{sourceLabels(q.refs, draft)}</p>
                </div>
              </details>
            ))}
            <h3>Activities</h3>
            {draft.output.activities.map((a, index) => (
              <div className="prep-activity form" key={a.id}>
                <label className="prep-member">
                  <input
                    type="checkbox"
                    checked={!draft.excludedActivityIds.includes(a.id)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        excludedActivityIds: e.target.checked
                          ? draft.excludedActivityIds.filter(
                              (id) => id !== a.id,
                            )
                          : [...draft.excludedActivityIds, a.id],
                      })
                    }
                  />
                  Include activity
                </label>
                <label>
                  Title
                  <input
                    maxLength={200}
                    value={a.title}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        output: {
                          ...draft.output,
                          activities: draft.output.activities.map((item, i) =>
                            i === index
                              ? { ...item, title: e.target.value }
                              : item,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Instructions
                  <textarea
                    maxLength={1500}
                    value={a.detail}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        output: {
                          ...draft.output,
                          activities: draft.output.activities.map((item, i) =>
                            i === index
                              ? { ...item, detail: e.target.value }
                              : item,
                          ),
                        },
                      })
                    }
                  />
                </label>
                <div className="twocol">
                  <label>
                    Minutes
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={a.minutes}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          output: {
                            ...draft.output,
                            activities: draft.output.activities.map(
                              (item, i) =>
                                i === index
                                  ? { ...item, minutes: Number(e.target.value) }
                                  : item,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Priority
                    <select
                      value={a.priority}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          output: {
                            ...draft.output,
                            activities: draft.output.activities.map(
                              (item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      priority: Number(e.target.value),
                                    }
                                  : item,
                            ),
                          },
                        })
                      }
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="tiny muted">{sourceLabels(a.refs, draft)}</p>
              </div>
            ))}
            <h3>Schedule preview</h3>
            {draftSchedule ? (
              <>
                <p>
                  {draftSchedule!.used} / {draftSchedule!.capacity} minutes
                  allocated.
                </p>
                {draftSchedule!.weeks.map((week, i) => (
                  <p className="tiny" key={week.start}>
                    Week {i + 1} · {week.start}–{week.end} · {week.used}/
                    {week.capacity} min:{" "}
                    {week.activityIds
                      .map(
                        (id) =>
                          draft.output.activities.find((a) => a.id === id)!
                            .title,
                      )
                      .join("; ") || "No activities fit."}
                  </p>
                ))}
                <p className="tiny">
                  Deferred:{" "}
                  {draftSchedule!.deferred
                    .map(
                      (id) =>
                        draft.output.activities.find((a) => a.id === id)!.title,
                    )
                    .join("; ") || "None"}
                </p>
              </>
            ) : (
              <p>
                Choose valid dates and weekly hours to preview the schedule.
              </p>
            )}
            <div className="actions">
              <button
                className="button"
                disabled={!!busy || !draftSchedule}
                onClick={() => void activate()}
              >
                Activate plan
              </button>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setDraft(null)}
              >
                Discard draft
              </button>
            </div>
            <p className="tiny muted">
              Activation preserves earlier versions and starts fresh progress.
              Failed saves retain this review.
            </p>
          </fieldset>
        </section>
      )}
      {target && plan && (
        <>
          <div className="notice">
            {readOnly ? "Previous version · read-only" : "Active plan"} ·{" "}
            {plan.settings.startDate} · {plan.metadata.provider} /{" "}
            {plan.metadata.model}
            {edits[plan.id] && " · Unsaved answer or score changes"}
          </div>
          {props.section === "practice" && selectedQuestion && progress && (
            <section className="card form practice">
              <label>
                Practice question
                <select
                  value={selectedQuestion.id}
                  onChange={(e) => setQuestionId(e.target.value)}
                >
                  {plan.output.questions.map((q, i) => (
                    <option key={q.id} value={q.id}>
                      {i + 1}. {q.text}
                    </option>
                  ))}
                </select>
              </label>
              <h2>{selectedQuestion.text}</h2>
              <p className="tiny muted">
                {sourceLabels(selectedQuestion.refs)}
              </p>
              <details>
                <summary>Suggested answer outline</summary>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {selectedQuestion.outline}
                </p>
                {selectedQuestion.evidenceRefs.map((ref) => {
                  const evidence = plan.sources
                    .find((s) => s.jobId === ref.jobId)
                    ?.evidenceSnapshot.find((e) => e.id === ref.evidenceId);
                  return (
                    <div
                      className="evidence"
                      key={`${ref.jobId}:${ref.evidenceId}`}
                    >
                      <strong>{evidence?.title}</strong>
                      <p>{evidence?.body}</p>
                    </div>
                  );
                })}
              </details>
              <label>
                Your answer notes · save to persist
                <textarea
                  maxLength={12000}
                  value={progress.answers[selectedQuestion.id] || ""}
                  disabled={readOnly || !!busy}
                  onChange={(e) =>
                    editProgress({
                      ...progress,
                      answers: {
                        ...progress.answers,
                        [selectedQuestion.id]: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <p className="tiny muted">
                Self-review only: 1 = weak, 3 = concrete but incomplete, 5 =
                clear and defensible. Notes do not complete rehearsal tasks.
              </p>
              <div className="score">
                {rubric.map((label) => (
                  <label key={label}>
                    {label}
                    <select
                      disabled={readOnly || !!busy}
                      value={
                        progress.scores[selectedQuestion.id]?.[label] || ""
                      }
                      onChange={(e) => {
                        const scores = {
                          ...progress.scores[selectedQuestion.id],
                        };
                        if (e.target.value)
                          scores[label] = Number(e.target.value);
                        else delete scores[label];
                        editProgress({
                          ...progress,
                          scores: {
                            ...progress.scores,
                            [selectedQuestion.id]: scores,
                          },
                        });
                      }}
                    >
                      <option value="">—</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                className="button"
                disabled={readOnly || !!busy || !edits[plan.id]}
                onClick={() => void saveProgress(progress)}
              >
                Save notes and scores
              </button>
            </section>
          )}
          {props.section === "study" && schedule && (
            <>
              <p>
                {schedule.used} / {schedule.capacity} minutes scheduled ·{" "}
                {plan.output.activities
                  .filter(
                    (a) =>
                      progress?.done[a.id] &&
                      schedule.weeks.some((w) => w.activityIds.includes(a.id)),
                  )
                  .reduce((n, a) => n + a.minutes, 0)}{" "}
                estimated minutes completed
              </p>
              {schedule.weeks.map((week, i) => (
                <section className="card" key={week.start}>
                  <h2>
                    Week {i + 1} · {week.start}–{week.end}
                  </h2>
                  <p className="tiny muted">
                    {week.used} / {week.capacity} minutes
                  </p>
                  {checklist(week.activityIds)}
                  {!week.activityIds.length && (
                    <p>No activities fit this week.</p>
                  )}
                </section>
              ))}
            </>
          )}
          {props.section === "tasks" && schedule && (
            <section className="card">
              <div className="actions">
                <label>
                  Job{" "}
                  <select
                    value={jobFilter}
                    onChange={(e) => setJobFilter(e.target.value)}
                  >
                    <option value="">All jobs</option>
                    {plan.sources.map((s) => (
                      <option key={s.jobId} value={s.jobId}>
                        {s.company} · {s.role}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Activity{" "}
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="">All types</option>
                    {activityTypes.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Status{" "}
                  <select
                    value={doneFilter}
                    onChange={(e) => setDoneFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    <option value="todo">To do</option>
                    <option value="done">Completed</option>
                  </select>
                </label>
              </div>
              {checklist(
                plan.output.activities
                  .filter(
                    (a) =>
                      !plan.excludedActivityIds.includes(a.id) &&
                      !schedule.deferred.includes(a.id) &&
                      (!jobFilter ||
                        a.refs.some((r) => r.jobId === jobFilter)) &&
                      (!typeFilter || a.type === typeFilter) &&
                      (!doneFilter ||
                        !!progress?.done[a.id] === (doneFilter === "done")),
                  )
                  .map((a) => a.id),
              )}
            </section>
          )}
          {(props.section === "study" || props.section === "tasks") &&
            schedule && (
              <section className="card">
                <h3>Deferred · outside the schedule</h3>
                {schedule.deferred.length ? (
                  checklist(
                    schedule.deferred.filter((id) => {
                      const a = plan.output.activities.find(
                        (a) => a.id === id,
                      )!;
                      return (
                        props.section !== "tasks" ||
                        ((!jobFilter ||
                          a.refs.some((r) => r.jobId === jobFilter)) &&
                          (!typeFilter || a.type === typeFilter) &&
                          (!doneFilter ||
                            !!progress?.done[id] === (doneFilter === "done")))
                      );
                    }),
                  )
                ) : (
                  <p>No selected activities were deferred.</p>
                )}
                <h3>Requirements without scheduled work</h3>
                {plan.sources.flatMap((source) =>
                  source.analysis.requirements
                    .filter(
                      (r) => !schedule.covered.has(`${source.jobId}:${r.id}`),
                    )
                    .map((r) => (
                      <p className="tiny" key={`${source.jobId}:${r.id}`}>
                        {source.company} · {r.requirement}
                      </p>
                    )),
                )}
                <p className="tiny muted">
                  Scheduled coverage does not establish skill mastery or
                  complete interview readiness.
                </p>
              </section>
            )}
        </>
      )}
      {target && !plan && !draft && (
        <p className="notice">
          No active plan yet. Complete the source analyses, choose your time
          budget, then generate and review a plan.
        </p>
      )}
      {target && props.section === "tasks" && (
        <section className="card">
          <h3>Earlier analysis tasks</h3>
          <p className="tiny muted">
            These remain separate from plan scheduling totals.
          </p>
          {workspace.tasks
            .filter((task) =>
              workspace.runs.some(
                (run) =>
                  run.id === task.run_id &&
                  target.jobIds.includes(run.application_id),
              ),
            )
            .map((task) => (
              <label className="check" key={task.id}>
                <input
                  type="checkbox"
                  disabled={props.savingTask === task.id}
                  checked={task.done}
                  onChange={(e) =>
                    void props.toggleLegacy(task.id, e.target.checked)
                  }
                />
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.detail}</p>
                </div>
              </label>
            ))}
        </section>
      )}
    </section>
  );
}
