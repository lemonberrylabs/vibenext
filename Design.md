# Technical Design Doc: Vibe Next (MVP)

**Version:** 0.1.0 (Unreleased)  
**Architecture:** Multi-Process Sidecar  
**Repository Structure:** Monorepo (pnpm + Turborepo)

---

## 1. System Overview

The system consists of two distinct npm packages managed in a monorepo.

| Package | Role | Port |
|---------|------|------|
| `@vibenext/control-plane` | Standalone Node.js server - runs Claude Agent SDK, manages Git state, performs file I/O. **Stateful - Source of Truth.** | 3001 |
| `@vibenext/client` | React Overlay component + implementation functions for Server Actions. Installed in user's Next.js app. **Stateless - UI only.** | 3000 |

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

## 2. Package 1: @vibenext/control-plane

**Role:** The Brain. Runs indefinitely, survives Next.js HMR restarts.  
**Tech Stack:** Node.js, Fastify, simple-git, @anthropic-ai/sdk

### 2.1 Server Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Port | 3001 (configurable via `VIBENEXT_PORT`) | |
| Host | `127.0.0.1` | Security: localhost only |
| Working Directory | `process.cwd()` | User's project root where `.git` lives |

### 2.2 Data Structures

Thread state is maintained in-memory as a `Map<string, Thread>`.

Key concepts:
- **ThreadStatus**: `IDLE` | `RUNNING` | `ERROR`
- **OperationType**: `creating` | `switching` | `merging` | `pushing` | `null`
- **Thread**: Contains id, branchName, status, history, operation, etc.

> See: `packages/control-plane/src/types.ts`

### 2.3 API Contract (HTTP)

All mutating endpoints return **immediately**. Background work updates thread state. Client polls for completion.

| Endpoint | Method | Action | Response |
|----------|--------|--------|----------|
| `/health` | GET | Health check | `{ status, workingDir }` |
| `/threads` | GET | List all threads | `ThreadStateResponse[]` |
| `/threads` | POST | Create thread (async) | `{ threadId, branchName, status }` |
| `/threads/:id` | GET | Get thread state | `ThreadStateResponse` |
| `/threads/:id/chat` | POST | Send message (async) | `{ status: 'RUNNING' }` |
| `/threads/:id/merge` | POST | Merge to main (async) | `{ success: true }` |
| `/threads/:id/switch` | POST | Switch branch (async) | `{ success: true }` |
| `/threads/:id/push` | POST | Push to remote (async) | `{ success: true }` |

> See: `packages/control-plane/src/server.ts`

### 2.4 Agent SDK Integration

System prompt instructs Claude to:
- Use `ls` and `grep` to explore before making changes
- Run `tsc` or build checks when unsure
- Make targeted, minimal changes
- Explain actions as it goes

**Tools provided:** `bash`, `read_file`, `write_file`, `list_files`

> See: `packages/control-plane/src/agent.ts`

### 2.5 Git Manager

Wraps `simple-git` with exponential backoff retry logic (5 retries) for lock conflicts.

Handles: `index.lock`, "Unable to create", "Another git process" errors.

> See: `packages/control-plane/src/git.ts`

---

## 3. Package 2: @vibenext/client

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

1. Package exports implementation functions from `@vibenext/client/lib/controlPlane`
2. User creates their own Server Actions that delegate to these functions
3. User passes actions to `VibeOverlay` as props

> See: `packages/client/src/lib/controlPlane.ts` for implementation functions  
> See: `packages/client/src/types.ts` for `VibeActions` interface

### 3.3 Security: Multi-Layer Production Protection

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

Escape hatch: `dangerouslyAllowProduction` option (not recommended).

### 3.4 Component: VibeOverlay.tsx

**State Management:**
- Uses `localStorage` for `vibe_active_thread_id` persistence
- Polls every 2 seconds when `thread.status === 'RUNNING'` or `thread.operation !== null`
- All state comes from Control Plane via polling

**UI Elements:**
| Element | Purpose |
|---------|---------|
| FAB | Minimize/expand toggle |
| LockScreen | Password gate when not authenticated |
| Branch Bar | Current branch, operation status, action buttons |
| Thread List | Dropdown to switch between sessions |
| Messages | Chat history with tool use visualization |
| Input | Send prompts to Claude |

> See: `packages/client/src/components/VibeOverlay.tsx`

---

## 4. CLI Runner

The `vibe-dev` script starts both Control Plane and Next.js dev server.

> See: `packages/control-plane/bin/vibe-dev.js`

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

- [x] Repo Setup: pnpm workspaces + Turborepo
- [x] Control Plane: Fastify server with localhost-only binding
- [x] Control Plane: GitManager with retry logic
- [x] Control Plane: Thread state machine with async operations
- [x] Control Plane: Anthropic SDK with tools
- [x] Control Plane: switch, push, merge endpoints (all async)
- [x] Client: controlPlane.ts implementation functions with production guard
- [x] Client: VibeOverlay.tsx with polling
- [x] Client: LockScreen.tsx for password auth
- [x] Client: Thread switching UI
- [x] Client: Push/merge buttons with operation status
- [x] CLI: vibe-dev runner script
- [x] Security: Multi-layer production protection
- [x] DevOps: GitHub Actions for lint/typecheck/build
