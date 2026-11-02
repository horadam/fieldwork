// Synthetic preparation-generation cases. The fit analyses are hand-labeled,
// not model output, so the eval isolates plan generation from analysis.
import type { Analysis, Experience, Job, Workspace } from "../lib/domain";
import type { PlanSettings, PreparationTarget } from "../lib/preparation-plan";

const experience: Experience[] = [
  {
    id: "e-react",
    title: "Synthetic · React dashboard",
    body: "Built a React and TypeScript dashboard with a Node API; wrote component tests.",
  },
  {
    id: "e-support",
    title: "Synthetic · support tooling",
    body: "Shared ownership of a ticket triage tool; added SQL reports for the support lead.",
  },
];
const frontend: Job = {
  id: "job-frontend",
  company: "Northwind Analytics",
  role: "Frontend Engineer",
  stage: "Interview",
  notes: "",
  jd: "Build accessible React interfaces. Requirements: React and TypeScript, accessibility (WCAG), automated testing.",
};
const platform: Job = {
  id: "job-platform",
  company: "Southwind Health",
  role: "Platform Engineer",
  stage: "Applied",
  notes: "",
  jd: "Run Node services on Kubernetes. Requirements: Node.js, Kubernetes, Postgres schema design, on-call.",
};
const frontendFit: Analysis = {
  summary: "Strong React evidence; accessibility is unproven.",
  requirements: [
    {
      id: "r1",
      requirement: "React and TypeScript",
      status: "supported",
      explanation: "Dashboard work covers both.",
      evidenceIds: ["e-react"],
    },
    {
      id: "r2",
      requirement: "Accessibility (WCAG)",
      status: "unsupported",
      explanation: "No accessibility work in the bank.",
      evidenceIds: [],
    },
    {
      id: "r3",
      requirement: "Automated testing",
      status: "partial",
      explanation: "Component tests only; no end-to-end tests.",
      evidenceIds: ["e-react"],
    },
  ],
  questions: [
    { text: "How do you test React components?", requirementId: "r3" },
  ],
  tasks: [
    {
      title: "Review WCAG basics",
      detail: "Read the POUR principles.",
      requirementId: "r2",
    },
  ],
};
const platformFit: Analysis = {
  summary: "Node and SQL are partly covered; Kubernetes and on-call are gaps.",
  requirements: [
    {
      id: "r1",
      requirement: "Node.js services",
      status: "partial",
      explanation: "A Node API, not production services.",
      evidenceIds: ["e-react"],
    },
    {
      id: "r2",
      requirement: "Kubernetes",
      status: "unsupported",
      explanation: "No container orchestration experience.",
      evidenceIds: [],
    },
    {
      id: "r3",
      requirement: "Postgres schema design",
      status: "partial",
      explanation: "SQL reports, not schema design.",
      evidenceIds: ["e-support"],
    },
    {
      id: "r4",
      requirement: "On-call",
      status: "unsupported",
      explanation: "No on-call experience.",
      evidenceIds: [],
    },
  ],
  questions: [{ text: "Describe a Node API you built.", requirementId: "r1" }],
  tasks: [
    {
      title: "Deploy to a local cluster",
      detail: "Use kind.",
      requirementId: "r2",
    },
  ],
};
const run = (job: Job, output: Analysis) => ({
  id: `run-${job.id}`,
  application_id: job.id,
  status: "completed" as const,
  output,
  error: null,
  created_at: "2026-11-01T10:00:00.000Z",
  prompt_version: "hand-labeled",
  provider: "ollama" as const,
  model: "hand-labeled",
  duration_ms: 0,
  jd_snapshot: job.jd,
  evidence_snapshot: experience,
});
const workspace: Workspace = {
  jobs: [frontend, platform],
  experience,
  runs: [run(frontend, frontendFit), run(platform, platformFit)],
  tasks: [],
};
const settings = (hoursPerWeek: number): PlanSettings => ({
  startDate: "2026-11-02",
  duration: "week",
  deadline: null,
  hoursPerWeek,
});
const target = (
  id: string,
  jobIds: string[],
  hours: number,
): PreparationTarget => ({
  id,
  name: id,
  jobIds,
  settings: settings(hours),
  activeVersionId: null,
});

export const preparationCases = [
  {
    id: "single-job-gaps",
    workspace,
    target: target("c1a1c1a1-0000-4000-8000-000000000001", [frontend.id], 6),
  },
  {
    id: "two-jobs-combined",
    workspace,
    target: target(
      "c1a1c1a1-0000-4000-8000-000000000002",
      [frontend.id, platform.id],
      10,
    ),
  },
  {
    id: "tight-budget",
    workspace,
    target: target("c1a1c1a1-0000-4000-8000-000000000003", [platform.id], 1),
  },
];
