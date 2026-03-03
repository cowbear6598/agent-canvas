import type { PersistedMessage } from '../types';

interface SummaryPromptContext {
  sourcePodName: string;
  sourcePodOutputStyle: string | null;
  targetPodName: string;
  targetPodOutputStyle: string | null;
  targetPodCommand: string | null;
  conversationHistory: string;
}

class SummaryPromptBuilder {
  buildSystemPrompt(sourcePodOutputStyle: string | null): string {
    if (sourcePodOutputStyle) {
      return `${sourcePodOutputStyle}

---

你現在正在執行一個特殊任務：摘要對話內容。
請保持你原有的語氣風格和專業視角，將對話內容擷取並摘要。`;
    }

    return `你是一個專業的內容摘要助手。
你的任務是將對話內容進行擷取和摘要，產出精簡且重點明確的內容。
請用繁體中文回應。`;
  }

  buildUserPrompt(context: SummaryPromptContext): string {
    const { sourcePodName, targetPodName, targetPodCommand, targetPodOutputStyle, conversationHistory } = context;

    if (targetPodCommand && targetPodCommand.trim()) {
      return `以下是來自「${sourcePodName}」的完整對話記錄：

---
${conversationHistory}
---

下一個處理者「${targetPodName}」的指令內容如下：

---
${targetPodCommand}
---

請根據此指令內容，從對話記錄中擷取相關資訊並進行精簡摘要。
只輸出摘要內容，不要加上任何解釋或前綴。`;
    }

    if (targetPodOutputStyle) {
      return `以下是來自「${sourcePodName}」的完整對話記錄：

---
${conversationHistory}
---

下一個處理者「${targetPodName}」的角色定位如下：

---
${targetPodOutputStyle}
---

請根據這個角色定位，從對話記錄中擷取與此角色相關的內容，並進行精簡摘要。
只輸出摘要內容，不要加上任何解釋或前綴。`;
    }

    return `以下是來自「${sourcePodName}」的完整對話記錄：

---
${conversationHistory}
---

請對這段對話進行完整摘要，擷取所有重要資訊和結論。
摘要應該精簡但完整，讓下一個處理者能夠快速理解對話的要點。
只輸出摘要內容，不要加上任何解釋或前綴。`;
  }

  formatConversationHistory(messages: PersistedMessage[]): string {
    return messages
      .map((message) => {
        const role = message.role === 'user' ? 'User' : 'Assistant';
        return `[${role}]: ${message.content}`;
      })
      .join('\n\n');
  }
}

export const summaryPromptBuilder = new SummaryPromptBuilder();
