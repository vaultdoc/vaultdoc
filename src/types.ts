export interface DocMeta {
  title: string;
  category: string;
  tags: string[];
  updatedAt: string;
  updatedBy: string;
}

export interface Doc {
  path: string;
  meta: DocMeta;
  content: string;
}

export interface DocSummary {
  path: string;
  title: string;
  category: string;
  tags: string[];
  updatedAt: string;
}

export type DocCategory =
  | "runbook"
  | "architecture"
  | "onboarding"
  | "incident"
  | "devops"
  | "api"
  | "process"
  | "general";
