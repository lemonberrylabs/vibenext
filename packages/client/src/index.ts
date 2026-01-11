// Components
export { VibeOverlay } from "./components/VibeOverlay";
export { LockScreen } from "./components/LockScreen";

// Types
export type {
  ThreadStatus,
  ThreadMessage,
  ContentBlock,
  ThreadState,
  CreateThreadResult,
  ChatResult,
  MergeResult,
  ActionResult,
} from "./types";

// Server Actions - re-export for convenience
export {
  createThread,
  getThreadState,
  sendPrompt,
  mergeThread,
  checkHealth,
  listThreads,
  switchThread,
} from "./actions/controlPlane";

export {
  authenticate,
  checkAuth,
  logout,
} from "./actions/auth";
