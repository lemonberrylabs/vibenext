export type ThreadStatus = "IDLE" | "RUNNING" | "ERROR";

export interface ThreadMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

export interface ThreadState {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: ThreadMessage[];
  lastCommitHash: string | null;
  errorMessage?: string;
}

export interface CreateThreadResult {
  threadId: string;
  branchName: string;
  status: ThreadStatus;
}

export interface ChatResult {
  status: ThreadStatus;
}

export interface MergeResult {
  success: boolean;
  error?: string;
}

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
