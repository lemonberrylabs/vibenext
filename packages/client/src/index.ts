// Components
export { VibeOverlay } from "./components/VibeOverlay.js";
export { LockScreen } from "./components/LockScreen.js";

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
} from "./types.js";

// Server Actions - re-export for convenience
export {
  createThread,
  getThreadState,
  sendPrompt,
  mergeThread,
  checkHealth,
  listThreads,
  switchThread,
} from "./actions/proxy.js";

export {
  authenticate,
  checkAuth,
  logout,
} from "./actions/auth.js";
