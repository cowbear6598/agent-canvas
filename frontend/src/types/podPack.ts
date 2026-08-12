import type { Connection, PasteConnectionItem, PastePodItem, Pod } from "@/types";

export type PodPackDependencyAction = "reuse" | "install" | "rename";

export interface PodPackDependencyPreview {
  originalKey: string;
  name: string;
  resolvedName: string;
  fingerprint: string;
  action: PodPackDependencyAction;
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
  version: 1;
  podCount: number;
  connectionCount: number;
  plugins: PodPackDependencyPreview[];
  managedMcps: PodPackDependencyPreview[];
}

export interface PodPackExportRequest {
  pods: PastePodItem[];
  connections: PasteConnectionItem[];
}

export interface PodPackImportResult {
  success: true;
  preview: PodPackPreview;
  createdPods: Pod[];
  createdConnections: Array<Omit<Connection, "status">>;
  podIdMapping: Record<string, string>;
}
