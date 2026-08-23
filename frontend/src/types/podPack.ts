import type {
  Connection,
  PasteConnectionItem,
  PastePodItem,
  PasteRepositoryNoteItem,
  Pod,
  RepositoryNote,
} from "@/types";

export type PodPackDependencyAction = "reuse" | "install" | "rename";

export interface PodPackDependencyPreview {
  originalKey: string;
  name: string;
  resolvedName: string;
  fingerprint: string;
  action: PodPackDependencyAction;
  source?: "git" | "directory" | { type: "github" | "upload"; ref: string };
  skills?: Array<{ skillName: string; description: string }>;
  executableFiles?: string[];
  envKeys?: string[];
  transport?: "stdio" | "http" | "sse";
  command?: string | null;
  args?: string[];
  url?: string | null;
}

export interface PodPackPreview {
  format: "agent-canvas-pod-pack";
  version: 1 | 2;
  podCount: number;
  connectionCount: number;
  repositories: PodPackDependencyPreview[];
  plugins: PodPackDependencyPreview[];
  managedMcps: PodPackDependencyPreview[];
  omitted: string[];
}

export interface PodPackExportRequest {
  pods: PastePodItem[];
  connections: PasteConnectionItem[];
  repositoryNotes: PasteRepositoryNoteItem[];
}

export interface PodPackImportResult {
  success: true;
  preview: PodPackPreview;
  createdPods: Pod[];
  createdRepositoryNotes: RepositoryNote[];
  createdConnections: Array<Omit<Connection, "status">>;
  podIdMapping: Record<string, string>;
}
