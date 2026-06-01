import { memoryStateService } from "./memoryStateService.js";
import type { Pod } from "../types/pod.js";

function buildTag(tagName: "pod-memory" | "repo-memory", summary: string): string {
  return `<${tagName}>\n${summary.trim()}\n</${tagName}>`;
}

class MemoryPromptService {
  buildHiddenBootstrapSections(pod: Pod): string[] {
    const podState = memoryStateService.getPodState(pod.id);
    const sections: string[] = [];

    if (podState?.memoryEnabled && podState.hasSummary && podState.summary) {
      sections.push(buildTag("pod-memory", podState.summary));
    }

    if (pod.repositoryId) {
      const repoState = memoryStateService.getRepoState(pod.repositoryId);
      if (repoState?.memoryEnabled && repoState.hasSummary && repoState.summary) {
        sections.push(buildTag("repo-memory", repoState.summary));
      }
    }

    return sections;
  }
}

export const memoryPromptService = new MemoryPromptService();
