import { type Experience, type Job, type Workspace } from "../domain";
import { importLocal, type ImportBatch } from "../resume";
import { seed } from "../seed";
import type { Request } from "../api-client";

export type Entity = "job" | "experience";
export type RecordValue = Omit<Job, "id"> | Pick<Experience, "title" | "body">;

/**
 * Where workspace data lives. Each operation takes the current state and
 * resolves to the next one, so the shell owns a single copy of the data and
 * never branches on storage mode itself.
 */
export interface WorkspaceStore {
  readonly kind: "browser" | "account";
  load(): Promise<Workspace>;
  // `id` edits an existing record; otherwise `createId` names the new one, so
  // retrying a save that already reached storage does not duplicate it.
  save(
    current: Workspace,
    entity: Entity,
    record: { id?: string; createId: string; value: RecordValue },
  ): Promise<Workspace>;
  remove(current: Workspace, entity: Entity, id: string): Promise<Workspace>;
  importExperience(current: Workspace, batch: ImportBatch): Promise<Workspace>;
  setTaskDone(
    current: Workspace,
    id: string,
    done: boolean,
  ): Promise<Workspace>;
  // Writes in-progress state (such as a running browser analysis); throws if
  // the browser refuses the write.
  persist(next: Workspace): void;
}

export const BROWSER_STORAGE_KEY = "fieldwork-demo-v1";
const MAX_EXPERIENCE = 50;

function withTaskDone(current: Workspace, id: string, done: boolean) {
  return {
    ...current,
    tasks: current.tasks.map((t) => (t.id === id ? { ...t, done } : t)),
  };
}

// `storage` is read lazily: the shell also renders on the server, where
// localStorage does not exist.
export function browserStore(storage: () => Storage): WorkspaceStore {
  const persist = (next: Workspace) => {
    try {
      storage().setItem(BROWSER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw new Error(
        "Browser storage is full or unavailable; this change was not saved.",
      );
    }
  };
  // Persist before resolving so a failed write leaves the caller's form open.
  const commit = async (next: Workspace) => {
    persist(next);
    return next;
  };
  return {
    kind: "browser",
    async load() {
      let saved: string | null;
      try {
        saved = storage().getItem(BROWSER_STORAGE_KEY);
      } catch {
        throw new Error("Saved browser data could not be loaded.");
      }
      if (!saved) return structuredClone(seed);
      let restored: Workspace;
      try {
        restored = JSON.parse(saved);
      } catch {
        throw new Error("Saved browser data could not be loaded.");
      }
      // A reload interrupts any browser analysis; never leave it spinning.
      restored.runs = restored.runs.map((r) =>
        r.status === "running" || r.status === "pending"
          ? {
              ...r,
              status: "failed",
              error:
                "Execution interrupted by reload. Retry explicitly; no tasks were created.",
            }
          : r,
      );
      return restored;
    },
    async save(current, entity, { id, createId, value }) {
      const key = id || createId;
      if (entity === "job")
        return commit({
          ...current,
          // Replace in place so an edit keeps the record's position.
          jobs: current.jobs.some((j) => j.id === key)
            ? current.jobs.map((j) =>
                j.id === key ? ({ ...value, id: key } as Job) : j,
              )
            : [...current.jobs, { ...value, id: key } as Job],
        });
      const existing = current.experience.find((e) => e.id === key);
      if (!existing && current.experience.length >= MAX_EXPERIENCE)
        throw new Error("Experience bank is limited to 50 entries.");
      return commit({
        ...current,
        experience: existing
          ? current.experience.map((e) =>
              e.id === key ? { ...e, ...value, id: key } : e,
            )
          : [...current.experience, { ...(value as Experience), id: key }],
      });
    },
    async remove(current, entity, id) {
      if (entity === "experience")
        return commit({
          ...current,
          experience: current.experience.filter((e) => e.id !== id),
        });
      const runs = new Set(
        current.runs.filter((r) => r.application_id === id).map((r) => r.id),
      );
      return commit({
        ...current,
        jobs: current.jobs.filter((j) => j.id !== id),
        runs: current.runs.filter((r) => !runs.has(r.id)),
        tasks: current.tasks.filter((t) => !runs.has(t.run_id)),
      });
    },
    async importExperience(current, batch) {
      return commit({
        ...current,
        experience: importLocal(current.experience, batch),
      });
    },
    async setTaskDone(current, id, done) {
      return commit(withTaskDone(current, id, done));
    },
    persist,
  };
}

// Signed-in storage through the API. Writes reload the workspace so server
// rules (quotas, cascades, approval) are reflected exactly.
export function accountStore(request: Request): WorkspaceStore {
  const load = () => request<Workspace>("/api/workspace");
  return {
    kind: "account",
    load,
    async save(_current, entity, { id, createId, value }) {
      await request("/api/workspace", {
        body: {
          entity,
          action: "save",
          ...(id ? { id } : { createId }),
          value,
        },
      });
      return load();
    },
    async remove(_current, entity, id) {
      await request("/api/workspace", {
        body: { entity, action: "delete", id },
      });
      return load();
    },
    async importExperience(_current, batch) {
      await request("/api/experience/import", { body: batch });
      return load();
    },
    // A checkbox needs no full reload; the caller has already shown the change.
    async setTaskDone(current, id, done) {
      await request("/api/workspace", {
        body: { entity: "task", action: "save", id, value: { done } },
      });
      return withTaskDone(current, id, done);
    },
    persist() {
      /* Account data is written by each operation. */
    },
  };
}
