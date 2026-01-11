// Components
export { VibeOverlay } from "./components/VibeOverlay";
export type { VibeOverlayProps } from "./components/VibeOverlay";
export { LockScreen } from "./components/LockScreen";
export type { LockScreenProps } from "./components/LockScreen";

// Types
export type {
  ThreadStatus,
  OperationType,
  ThreadMessage,
  ContentBlock,
  ThreadState,
  CreateThreadResult,
  ChatResult,
  MergeResult,
  ActionResult,
  VibeActions,
} from "./types";

// Implementation functions are exported from ./lib/controlPlane
// Users should import them as:
// import { createThreadImpl, ... } from "@vibecoder/client/lib/controlPlane"

// Re-export ControlPlaneConfig type for users who need it
export type { ControlPlaneConfig } from "./lib/controlPlane";
