# Technical Design Doc: Vibe Coder (MVP)

**Version:** 0.1.0 (Unreleased)  
**Architecture:** Multi-Process Sidecar  
**Repository Structure:** Monorepo (pnpm + Turborepo)

---

## 1. System Overview

The system consists of two distinct npm packages managed in a monorepo.

| Package | Role | Port |
|---------|------|------|
| `@vibecoder/control-plane` | Standalone Node.js server - runs Claude Agent SDK, manages Git state, performs file I/O. **Stateful - Source of Truth.** | 3001 |
| `@vibecoder/client` | React Overlay component + implementation functions for Server Actions. Installed in user's Next.js app. **Stateless - UI only.** | 3000 |

### 1.1 Communication Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    FUNDAMENTAL DESIGN PRINCIPLE                  │
├─────────────────────────────────────────────────────────────────┤
│  • Control Plane is STATEFUL - maintains all thread state       │
│  • App is STATELESS - can restart at any time (HMR/crash)       │
│  • All commands return IMMEDIATELY (acknowledgment only)        │
│  • App POLLS for current state when needed                      │
│  • Never rely on the app staying up                             │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:**
1. Client sends command (create, chat, merge, switch, push)
2. Control Plane acknowledges immediately (`{ success: true }`)
3. Control Plane executes work in background
4. Client polls `GET /threads/:id` for state updates
5. Client updates UI based on polled state

---

## 2. Package 1: @vibecoder/control-plane

**Role:** The Brain. Runs indefinitely, survives Next.js HMR restarts.  
**Tech Stack:** Node.js, Fastify, simple-git, @anthropic-ai/sdk

### 2.1 Server Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Port | 3001 (configurable via `VIBE_PORT`) | |
| Host | `127.0.0.1` | Security: localhost only |
| Working Directory | `process.cwd()` | User's project root where `.git` lives |

### 2.2 Data Structures (In-Memory)

```typescript
type ThreadStatus = 'IDLE' | 'RUNNING' | 'ERROR';

/** Async operations that can be in progress */
type OperationType = 'creating' | 'switching' | 'merging' | 'pushing' | null;

interface Thread {
  id: string;                    // UUID
  branchName: string;            // "feat/vibe-{id.slice(0,8)}"
  createdAt: number;             // Timestamp
  status: ThreadStatus;          // Current status
  history: MessageParam[];       // Anthropic SDK Message format
  lastCommitHash: string | null; // Latest auto-commit
  errorMessage?: string;         // Error details if status === 'ERROR'
  operation: OperationType;      // Current async operation in progress
}

// Global State
const threads = new Map<string, Thread>();
```

### 2.3 API Contract (HTTP)

All mutating endpoints return **immediately**. Background work updates thread state. Client polls for completion.

#### `GET /health`
- **Response:** `{ status: 'ok', workingDir: string }`

#### `GET /threads`
- **Response:** `ThreadStateResponse[]` - All threads with full state

#### `POST /threads`
- **Action:** 
  1. Generate `threadId`, create Thread record with `operation: 'creating'`
  2. Return immediately
  3. Background: Auto-commit dirty changes, create branch `feat/vibe-{id}`
  4. Background complete: Set `operation: null`
- **Response:** `{ threadId, branchName, status: 'IDLE' }`

#### `GET /threads/:id`
- **Response:** Full `ThreadStateResponse` (status, history, operation, etc.)
- **Use Case:** Client polling for updates

#### `POST /threads/:id/chat`
- **Payload:** `{ message: string }`
- **Action:**
  1. Validate thread exists and not busy (`status !== 'RUNNING'`, `operation === null`)
  2. Set `status: 'RUNNING'`, return immediately
  3. Background: Checkout branch, invoke Claude Agent
  4. Background: On completion, auto-commit, set `status: 'IDLE'`
- **Response:** `{ status: 'RUNNING' }`

#### `POST /threads/:id/merge`
- **Action:**
  1. Validate thread, set `operation: 'merging'`, return immediately
  2. Background: Checkout thread branch, commit changes, checkout main, merge, push
  3. Background complete: Delete thread from registry
- **Response:** `{ success: true }`

#### `POST /threads/:id/switch`
- **Action:**
  1. Validate thread, set `operation: 'switching'`, return immediately
  2. Background: Auto-commit current changes, checkout target branch
  3. Background complete: Set `operation: null`
- **Response:** `{ success: true }`

#### `POST /threads/:id/push`
- **Action:**
  1. Validate thread, set `operation: 'pushing'`, return immediately
  2. Background: Commit changes, push branch to remote
  3. Background complete: Set `operation: null`
- **Response:** `{ success: true }`

### 2.4 Agent SDK Integration

```typescript
const SYSTEM_PROMPT = `You are a coding assistant modifying the local codebase.

IMPORTANT GUIDELINES:
- Use ls and grep to explore the codebase before making changes.
- Always run tsc or a build check if unsure before finishing.
- Make targeted, minimal changes to accomplish the user's request.
- If you encounter errors, try to fix them before giving up.
- Explain what you're doing as you go.

You have access to the filesystem and can execute bash commands.`;
```

**Tools Provided:**
| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands (60s timeout) |
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `list_files` | List directory contents |

### 2.5 Git Manager

Wraps `simple-git` with exponential backoff retry logic for lock conflicts:

```typescript
class GitManager {
  // Retry up to 5 times with exponential backoff
  // Handles: index.lock, "Unable to create", "Another git process"
  private async withRetry<T>(operation: () => Promise<T>): Promise<T>;
  
  async isDirty(): Promise<boolean>;
  async getCurrentBranch(): Promise<string>;
  async autoCommit(message: string): Promise<string | null>;
  async createBranch(branchName: string): Promise<void>;
  async checkout(branchName: string): Promise<void>;
  async merge(branchName: string): Promise<void>;
  async push(remote: string, branch: string): Promise<void>;
}
```

---

## 3. Package 2: @vibecoder/client

**Role:** The Interface. Embeddable into user's Next.js App.  
**Tech Stack:** React, Next.js Server Actions

### 3.1 Directory Structure

```
/src
  /components
    VibeOverlay.tsx     <-- Main UI component
    LockScreen.tsx      <-- Password authentication gate
  /lib
    controlPlane.ts     <-- Implementation functions (NOT server actions)
  /types.ts             <-- Shared TypeScript types
  /index.ts             <-- Public exports
```

### 3.2 NPM Package Consumption Pattern

Since Server Actions cannot be directly exported from npm packages, we use a delegation pattern:

```typescript
// In @vibecoder/client/lib/controlPlane.ts
export async function createThreadImpl(config?: ControlPlaneConfig): Promise<ActionResult<CreateThreadResult>>;
export async function getThreadStateImpl(threadId: string, config?: ControlPlaneConfig): Promise<ActionResult<ThreadState>>;
export async function sendPromptImpl(threadId: string, message: string, config?: ControlPlaneConfig): Promise<ActionResult<ChatResult>>;
// ... etc
```

**User creates their own Server Actions that delegate:**

```typescript
// app/actions/vibe.ts (in user's app)
"use server";

import { createThreadImpl } from "@vibecoder/client/lib/controlPlane";

export const createThread = () => withAuth(() => createThreadImpl());
```

### 3.3 VibeActions Interface

The `VibeOverlay` component accepts actions as props:

```typescript
interface VibeActions {
  authenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
  checkAuth: () => Promise<{ authenticated: boolean; configured: boolean }>;
  createThread: () => Promise<ActionResult<CreateThreadResult>>;
  getThreadState: (threadId: string) => Promise<ActionResult<ThreadState>>;
  sendPrompt: (threadId: string, message: string) => Promise<ActionResult<ChatResult>>;
  mergeThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  pushThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  switchThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  checkHealth: () => Promise<ActionResult<{ status: string; workingDir: string }>>;
  listThreads: () => Promise<ActionResult<ThreadState[]>>;
}
```

### 3.4 Security: Multi-Layer Production Protection

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRODUCTION SAFETY LAYERS                      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: VibeOverlay returns null in production                │
│  Layer 2: controlPlane.ts functions return error in production  │
│  Layer 3: Control Plane only binds to 127.0.0.1                 │
│  Layer 4: Password authentication required                       │
│  Layer 5: HTTPOnly cookies for session                          │
└─────────────────────────────────────────────────────────────────┘
```

**Escape Hatch (NOT RECOMMENDED):**
```typescript
<VibeOverlay actions={actions} dangerouslyAllowProduction={true} />
createThreadImpl({ dangerouslyAllowProduction: true })
```

### 3.5 Component: VibeOverlay.tsx

**State Management:**
- Uses `localStorage` for `vibe_active_thread_id` persistence
- Polls every 2 seconds when `thread.status === 'RUNNING'` or `thread.operation !== null`
- All state comes from Control Plane via polling

**UI Elements:**
| Element | Purpose |
|---------|---------|
| FAB (Floating Action Button) | Minimize/expand toggle |
| LockScreen | Password gate when not authenticated |
| Branch Bar | Shows current branch, operation status, action buttons |
| Thread List | Dropdown to switch between sessions |
| Messages | Chat history with tool use visualization |
| Input | Send prompts to Claude |

**Operation Status Display:**
- `operation === 'creating'` → "Creating branch..."
- `operation === 'switching'` → "Switching..."
- `operation === 'merging'` → "Merging..."
- `operation === 'pushing'` → "Pushing..."
- `status === 'RUNNING'` → "Working..."
- `status === 'ERROR'` → Error badge

---

## 4. Integration & Developer Experience

### 4.1 CLI Runner (`vibe-dev`)

```javascript
#!/usr/bin/env node
// bin/vibe-dev.js

import { spawn } from "node:child_process";

// 1. Start Control Plane (port 3001)
const controlPlane = spawn("node", [CONTROL_PLANE_SCRIPT], {
  stdio: "inherit",
  cwd: process.cwd(),
});

// 2. Start Next.js (port 3000)
setTimeout(() => {
  spawn("npx", ["next", "dev"], { stdio: "inherit", cwd: process.cwd() });
}, 1000);

// 3. Handle graceful shutdown
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
```

### 4.2 User Installation

```bash
pnpm add -D @vibecoder/client @vibecoder/control-plane
```

**Environment Variables (.env.local):**
```env
VIBE_PASSWORD=your_secret_password
ANTHROPIC_API_KEY=your_anthropic_key
```

**Layout Integration:**
```tsx
// app/layout.tsx
import { VibeOverlay } from "@vibecoder/client";
import * as vibeActions from "./actions/vibe";

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        <VibeOverlay actions={vibeActions} />
      </body>
    </html>
  );
}
```

> **Note:** No need for `process.env.NODE_ENV === 'development'` check - VibeOverlay automatically disables itself in production.

**Run:**
```bash
npx vibe-dev
```

---

## 5. Critical Edge Cases

| Case | Handling |
|------|----------|
| **Git Lock Conflict** | `GitManager.withRetry()` - exponential backoff, 5 retries |
| **Port 3001 In Use** | Fail fast with clear error message |
| **Control Plane Down** | Client shows "Disconnected" badge, retries every 10s |
| **HMR Restart** | Client recovers state from Control Plane via `localStorage` thread ID |
| **Concurrent Operations** | Reject with error if `operation !== null` |
| **Thread Deleted** | Client detects 404, clears localStorage, shows welcome screen |
| **Production Deployment** | Multiple layers prevent any functionality |

---

## 6. Implementation Checklist

- [x] **Repo Setup:** Initialize monorepo with pnpm workspaces + Turborepo
- [x] **Control Plane:** Scaffold Fastify server with localhost-only binding
- [x] **Control Plane:** Implement GitManager with retry logic
- [x] **Control Plane:** Implement Thread state machine with async operations
- [x] **Control Plane:** Integrate Anthropic SDK with tools (bash, read_file, write_file, list_files)
- [x] **Control Plane:** Add switch, push, merge endpoints (all async)
- [x] **Client:** Build controlPlane.ts implementation functions with production guard
- [x] **Client:** Build VibeOverlay.tsx with polling (2s interval when busy)
- [x] **Client:** Build LockScreen.tsx for password authentication
- [x] **Client:** Add thread switching UI
- [x] **Client:** Add push/merge buttons with operation status display
- [x] **Glue:** Create vibe-dev runner script (ESM)
- [x] **Security:** Multi-layer production protection
- [x] **DevOps:** GitHub Actions for lint/typecheck/build
- [x] **Docs:** README with quick start and API reference

---

## 7. Type Definitions Reference

### Control Plane Types

```typescript
// packages/control-plane/src/types.ts

type ThreadStatus = "IDLE" | "RUNNING" | "ERROR";
type OperationType = "creating" | "switching" | "merging" | "pushing" | null;

interface Thread {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: MessageParam[];
  lastCommitHash: string | null;
  errorMessage?: string;
  operation: OperationType;
}

interface CreateThreadResponse {
  threadId: string;
  branchName: string;
  status: ThreadStatus;
}

interface ChatResponse {
  status: ThreadStatus;
}

interface MergeResponse {
  success: boolean;
  error?: string;
}

interface ThreadStateResponse extends Thread {}
```

### Client Types

```typescript
// packages/client/src/types.ts

interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ThreadState {
  id: string;
  branchName: string;
  createdAt: number;
  status: ThreadStatus;
  history: ThreadMessage[];
  lastCommitHash: string | null;
  errorMessage?: string;
  operation?: OperationType;
}

interface ControlPlaneConfig {
  url?: string;
  dangerouslyAllowProduction?: boolean;
}
```
