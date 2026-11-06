"use client";
import { useEffect, useRef, useState } from "react";
import type { Experience, Job } from "@/lib/domain";
import type { Entity } from "@/lib/store";
import { ResumeImport } from "./resume-import";
import { JobImport } from "./job-import";
import { PreparationWorkspace } from "./preparation-workspace";
import { ApplicationsView } from "./applications-view";
import { Dialog } from "./modals/dialog";
import { RecordFormBody, type RecordForm } from "./modals/record-form";
import { ConfirmDeleteBody } from "./modals/confirm-delete";
import { AuthFormBody } from "./modals/auth-form";
import { Sidebar } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";
import { tabById, type TabId } from "./shell/tabs";
import { OverviewView } from "./views/overview-view";
import { ExperienceView } from "./views/experience-view";
import { GeneralPracticeView } from "./views/general-practice-view";
import { GeneralStudyView, studyTotal } from "./views/general-study-view";
import { EarlierTasksView } from "./views/earlier-tasks-view";
import { useWorkspaceData } from "./hooks/use-workspace-data";
import { useAiStatus } from "./hooks/use-ai-status";
import { DemoNotice } from "./shell/demo-notice";
import { KeyForm } from "./shell/model-key";
import { signupsOpen } from "@/lib/deployment";
import type { PlanSummary } from "@/lib/preparation-plan";
import { useNavPreference } from "./hooks/use-nav-preference";
import { usePracticeNotes } from "./hooks/use-practice-notes";

type Modal =
  // createId is minted when the form opens, so a retried save reuses it.
  | { type: "record"; form: RecordForm; createId: string }
  | { type: "job-import" }
  | { type: "resume-import" }
  | { type: "auth" }
  | { type: "openai-key" }
  | { type: "delete"; entity: Entity; id: string };

const modalTitle = (modal: Modal) =>
  modal.type === "job-import"
    ? "Import job from URL"
    : modal.type === "resume-import"
      ? "Import resume"
      : modal.type === "auth"
        ? "Your private workspace"
        : modal.type === "openai-key"
          ? "Your OpenAI key"
          : modal.type === "delete"
            ? "Delete this record?"
            : modal.form.entity === "job"
              ? modal.form.value
                ? "Edit application"
                : "Add application"
              : modal.form.value
                ? "Edit experience"
                : "Add user-confirmed experience";

export default function Workspace() {
  const ws = useWorkspaceData();
  const ai = useAiStatus(ws.request, ws.token);
  const nav = useNavPreference();
  const notes = usePracticeNotes(ws.mode === "live" ? ws.email : "demo");
  const [tab, setTab] = useState<TabId>("overview");
  const [modal, setModal] = useState<Modal | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [generalPreparation, setGeneralPreparation] = useState(true);
  const [preparationJob, setPreparationJob] = useState<string | null>(null);
  const [preparationTarget, setPreparationTarget] = useState<string | null>(
    null,
  );
  const [planSummaries, setPlanSummaries] = useState<PlanSummary[]>([]);
  const [prepContext, setPrepContext] = useState<{
    name: string;
    next: string;
    targetId: string;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);
  const current = tabById(tab);

  // Move focus to the new view's heading after navigation, not on first load.
  useEffect(() => {
    if (navigated.current) heading.current?.focus();
  }, [tab]);
  function navigate(next: TabId) {
    navigated.current = true;
    setStatusOpen(false);
    setTab(next);
    ws.setSelectedRun(null);
    ws.setError("");
  }
  function open(next: Modal) {
    ws.setError("");
    setModal(next);
  }
  const close = () => {
    if (!ws.busy) setModal(null);
  };
  const addRecord = (entity: Entity) =>
    open({
      type: "record",
      form: entity === "job" ? { entity: "job" } : { entity: "experience" },
      createId: crypto.randomUUID(),
    });
  const editJob = (value: Job) =>
    open({
      type: "record",
      form: { entity: "job", value },
      createId: value.id,
    });
  const editExperience = (value: Experience) =>
    open({
      type: "record",
      form: { entity: "experience", value },
      createId: value.id,
    });
  const studyDone = Object.values(notes.study).filter(Boolean).length;
  const errorNotice = ws.error && (
    <div role="alert" className="notice error">
      {ws.error}
    </div>
  );

  return (
    <div className={`shell ${nav.collapsed ? "collapsed" : ""}`}>
      <Sidebar
        tab={tab}
        collapsed={nav.collapsed}
        onToggle={nav.toggle}
        onSelect={navigate}
      />
      <main className="main" id="main">
        <Topbar
          section={current.label}
          mode={ws.mode}
          email={ws.email}
          ai={ai.status}
          aiProblem={ai.problem}
          onRefreshStatus={ai.refresh}
          onSignIn={() => open({ type: "auth" })}
          onSignOut={ws.signOut}
          statusOpen={statusOpen}
          onStatusToggle={setStatusOpen}
          onSetUpKey={() => {
            setStatusOpen(false);
            open({ type: "openai-key" });
          }}
        />
        {/* Hosted copies explain themselves; local development doesn't need it. */}
        {ws.mode === "demo" && ai.status?.local === false && (
          <DemoNotice
            onAddKey={() => open({ type: "openai-key" })}
            onOpenApplications={() => navigate("applications")}
          />
        )}
        <header className="header">
          <div>
            <div className="eyebrow">
              {tab === "overview"
                ? "Prepare · build · progress"
                : current.label}
            </div>
            <h1 ref={heading} tabIndex={-1}>
              {tab === "study" && prepContext
                ? `Preparation for ${prepContext.name}`
                : current.title}
            </h1>
            <p className="sub">{current.subtitle}</p>
          </div>
          {tab === "applications" && (
            <div className="actions">
              <button
                className="button secondary"
                disabled={ws.busy}
                onClick={() => open({ type: "job-import" })}
              >
                Import job from URL
              </button>
              <button
                className="button"
                disabled={ws.busy}
                onClick={() => addRecord("job")}
              >
                + Add application
              </button>
            </div>
          )}
          {tab === "experience" && (
            <div className="actions">
              <button
                className="button secondary"
                disabled={ws.busy}
                onClick={() => open({ type: "resume-import" })}
              >
                Import resume
              </button>
              <button
                className="button"
                disabled={ws.busy}
                onClick={() => addRecord("experience")}
              >
                + Add experience
              </button>
            </div>
          )}
        </header>
        {!modal && errorNotice}
        {ws.busy && !(ws.runningJob && tab === "applications") && (
          <div role="status" className="notice">
            {ws.runningJob
              ? "Analysis running. You can review other sections while you wait."
              : "Saving your changes…"}
          </div>
        )}

        {tab === "overview" && (
          <OverviewView
            context={prepContext}
            onContinue={() => {
              if (prepContext) setPreparationTarget(prepContext.targetId);
              navigate("study");
            }}
            data={ws.data}
            planSummaries={planSummaries}
            studyDone={studyDone}
            studyTotal={studyTotal}
            onNavigate={navigate}
          />
        )}
        {tab === "experience" && (
          <ExperienceView
            experience={ws.data.experience}
            busy={ws.busy}
            onAdd={() => addRecord("experience")}
            onImport={() => open({ type: "resume-import" })}
            onEdit={editExperience}
            onDelete={(e) =>
              open({ type: "delete", entity: "experience", id: e.id })
            }
          />
        )}
        {tab === "applications" && (
          <ApplicationsView
            workspace={ws.data}
            mode={ws.mode}
            busy={ws.busy}
            aiReady={!!ai.status?.ready}
            ai={ai.status}
            runningJob={ws.runningJob}
            selectedRun={ws.selectedRun}
            onSelectRun={ws.setSelectedRun}
            onAnalyze={(job, simulated) => ws.runJob(job, ai.status, simulated)}
            onPrepare={(job) => {
              setPreparationJob(job.id);
              navigate("practice");
            }}
            onEdit={editJob}
            onDelete={(job) =>
              open({ type: "delete", entity: "job", id: job.id })
            }
            preparation={planSummaries}
            onOpenTarget={(targetId) => {
              setPreparationTarget(targetId);
              navigate("practice");
            }}
            onAdd={() => addRecord("job")}
          />
        )}

        {/* Stays mounted across tabs so unsaved preparation edits survive. */}
        <PreparationWorkspace
          key={`${ws.mode}:${ws.email}`}
          onNavigate={navigate}
          onContext={setPrepContext}
          section={tab}
          workspace={ws.data}
          token={ws.token}
          scope={ws.mode === "live" ? ws.email : "browser"}
          requestedJob={preparationJob}
          requestedTarget={preparationTarget}
          onRequestHandled={() => {
            setPreparationJob(null);
            setPreparationTarget(null);
          }}
          onSummaries={setPlanSummaries}
          onGeneralChange={setGeneralPreparation}
          analyze={(job) => ws.runJob(job, ai.status)}
          toggleLegacy={ws.toggleTask}
          shellBusy={ws.busy}
          savingTask={ws.savingTask}
          provider={ai.label}
          ai={ai.status}
        />

        {tab === "practice" && generalPreparation && (
          <GeneralPracticeView
            answers={notes.answers}
            setAnswers={notes.setAnswers}
            scores={notes.scores}
            setScores={notes.setScores}
          />
        )}
        {tab === "study" && generalPreparation && (
          <GeneralStudyView study={notes.study} setStudy={notes.setStudy} />
        )}
        {/* Tasks approved from analyses before plans replaced approval. */}
        {tab === "study" && generalPreparation && ws.data.tasks.length > 0 && (
          <EarlierTasksView
            tasks={ws.data.tasks}
            savingTask={ws.savingTask}
            onToggle={ws.toggleTask}
            onOpenApplications={() => navigate("applications")}
          />
        )}
        <footer>
          FIELDWORK · Built for deliberate progress.{" "}
          {ws.mode === "demo"
            ? "Workspace data and practice notes stay in this browser."
            : "Workspace records use your authenticated account. Practice notes stay in this browser."}
        </footer>
      </main>

      {modal && (
        <Dialog title={modalTitle(modal)} close={close}>
          {errorNotice}
          {modal.type === "job-import" ? (
            <JobImport
              provider={ai.label}
              ai={ai.status}
              request={(path, value, signal) =>
                ws.request(path, { body: value, signal })
              }
              confirm={ws.importJob}
              close={() => setModal(null)}
            />
          ) : modal.type === "resume-import" ? (
            <ResumeImport
              existing={ws.data.experience}
              provider={ai.label}
              ai={ai.status}
              request={(source, signal) =>
                ws.request("/api/resume/extract", { body: source, signal })
              }
              confirm={ws.importExperience}
              close={() => setModal(null)}
            />
          ) : modal.type === "auth" ? (
            <AuthFormBody
              available={ws.canSignIn}
              signupsOpen={signupsOpen()}
              busy={ws.busy}
              onSubmit={async (credentials, signup) => {
                const outcome = await ws.authenticate(credentials, signup);
                if (outcome === "signed-in") setModal(null);
                return outcome;
              }}
            />
          ) : modal.type === "openai-key" ? (
            <KeyForm onDone={() => setModal(null)} />
          ) : modal.type === "delete" ? (
            <ConfirmDeleteBody
              busy={ws.busy}
              consequence={
                modal.entity === "job"
                  ? "This also removes its analysis history and earlier approved tasks. Saved preparation plan snapshots and progress remain; affected targets will need their membership repaired before regeneration."
                  : "Previous analysis runs keep their saved evidence snapshot."
              }
              onConfirm={async () => {
                if (await ws.removeRecord(modal.entity, modal.id))
                  setModal(null);
              }}
              onCancel={close}
            />
          ) : (
            <RecordFormBody
              form={modal.form}
              busy={ws.busy}
              onCancel={close}
              onSave={async (value) => {
                const saved = await ws.saveRecord(modal.form.entity, {
                  id: modal.form.value?.id,
                  createId: modal.createId,
                  value,
                });
                if (saved) setModal(null);
              }}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}
