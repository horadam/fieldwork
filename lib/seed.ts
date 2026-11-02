import type { Workspace } from "./domain";
export const seed: Workspace = {
  jobs: [
    {
      id: "demo-job",
      company: "Example SaaS · synthetic",
      role: "Senior Full-stack / AI Engineer",
      stage: "Interview",
      notes:
        "Synthetic demo application. Replace with your real target privately.",
      jd: "Build products end to end with React, Next.js, and TypeScript.\nShip user-facing LLM features and iterate through evaluations.\nModel application data in Postgres and Supabase.\nGuide technical decisions and communicate tradeoffs.",
    },
  ],
  experience: [
    {
      id: "demo-e1",
      title: "Synthetic · full-stack delivery",
      body: "Built a React and TypeScript dashboard with a Node.js API. Owned the form UX, API validation, and automated release checks. This is fictional demo data.",
    },
    {
      id: "demo-e2",
      title: "Synthetic · AI workflow",
      body: "Helped implement an assistant that classified incoming requests and proposed responses for human review. Shared technical ownership with a team lead. This is fictional demo data.",
    },
  ],
  runs: [],
  tasks: [],
};
