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

/**
 * Server Action signatures that users must implement and pass to VibeOverlay
 */
export interface VibeActions {
  /** Authenticate with password */
  authenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
  /** Check if user is authenticated */
  checkAuth: () => Promise<{ authenticated: boolean; configured: boolean }>;
  /** Create a new thread/session */
  createThread: () => Promise<ActionResult<CreateThreadResult>>;
  /** Get thread state by ID */
  getThreadState: (threadId: string) => Promise<ActionResult<ThreadState>>;
  /** Send a prompt to the thread */
  sendPrompt: (threadId: string, message: string) => Promise<ActionResult<ChatResult>>;
  /** Merge thread to main branch */
  mergeThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  /** Check control plane health */
  checkHealth: () => Promise<ActionResult<{ status: string; workingDir: string }>>;
  /** List all threads */
  listThreads: () => Promise<ActionResult<ThreadState[]>>;
  /** Switch to a different thread */
  switchThread: (threadId: string) => Promise<ActionResult<ThreadState>>;
}
