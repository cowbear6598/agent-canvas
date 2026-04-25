import type { Pod } from "../pod.js";
import type { SkillNote } from "../skillNote.js";
import type { RepositoryNote } from "../repositoryNote.js";
import type { SubAgentNote } from "../subAgentNote.js";
import type { CommandNote } from "../commandNote.js";
import type { McpServerNote } from "../mcpServerNote.js";
import type { Connection } from "../connection.js";
import type { I18nError } from "../../utils/i18nError.js";

export interface PasteError {
  type:
    | "pod"
    | "skillNote"
    | "repositoryNote"
    | "subAgentNote"
    | "commandNote"
    | "mcpServerNote";
  originalId: string;
  error: string | I18nError;
}

export interface CanvasPasteResultPayload {
  requestId: string;
  success: boolean;
  createdPods: Pod[];
  createdSkillNotes: SkillNote[];
  createdRepositoryNotes: RepositoryNote[];
  createdSubAgentNotes: SubAgentNote[];
  createdCommandNotes: CommandNote[];
  createdMcpServerNotes: McpServerNote[];
  createdConnections: Connection[];
  podIdMapping: Record<string, string>;
  errors: PasteError[];
  error?: string;
}
