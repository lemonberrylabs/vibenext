// Components
export { VibeOverlay } from "./components/VibeOverlay.js";
export type { VibeOverlayProps } from "./components/VibeOverlay.js";
export { LockScreen } from "./components/LockScreen.js";
export type { LockScreenProps } from "./components/LockScreen.js";

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
} from "./types.js";

// Implementation functions are exported from ./lib/controlPlane
// Users should import them as:
// import { createThreadImpl, ... } from "@vibenext/client/lib/controlPlane"

// Re-export ControlPlaneConfig type for users who need it
export type { ControlPlaneConfig } from "./lib/controlPlane.js";
