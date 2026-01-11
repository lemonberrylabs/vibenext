Technical Design Doc: Vibe Coder (MVP)
Version: 1.0
Architecture: Multi-Process Sidecar
Repository Structure: Monorepo (Turborepo/Workspaces)
1. System Overview
The system consists of two distinct npm packages managed in a monorepo.
 * @vibecoder/control-plane: A standalone Node.js server (Port 3001) that runs the Claude Agent SDK, manages Git state, and performs file I/O. It is the "Source of Truth".
 * @vibecoder/client: A library containing the React Overlay and Next.js Server Actions to be installed in the user's Next.js application (Port 3000).
2. Package 1: @vibecoder/control-plane
Role: The Brain. It runs indefinitely, surviving Next.js HMR restarts.
Tech Stack: Node.js, Fastify (or Express), simple-git, @anthropic-ai/claude-agent-sdk.
2.1 Server Configuration
 * Port: Default 3001 (configurable via VIBE_PORT).
 * Security: Bind strictly to 127.0.0.1. Reject non-local requests.
 * Working Directory: Must be initialized with process.cwd() set to the user's project root (where .git lives).
2.2 Data Structures (In-Memory)
The server must maintain a registry of active threads.
type ThreadStatus = 'IDLE' | 'RUNNING' | 'ERROR';

interface Thread {
  id: string; // UUID
  branchName: string; // "feat/vibe-{id}"
  createdAt: number;
  status: ThreadStatus;
  history: Array<any>; // Anthropic SDK Message format
  lastCommitHash: string | null;
}

// Global State
const threads = new Map<string, Thread>();

2.3 API Contract (HTTP)
The Server Action from the client will consume these endpoints.
POST /threads
 * Action:
   * Generate threadId.
   * Check for uncommitted changes in current context. If dirty, auto-commit to current branch or stash.
   * Create new git branch: git checkout -b feat/vibe-{threadId}.
   * Initialize Agent instance for this thread.
 * Response: { threadId, branchName, status: 'IDLE' }
POST /threads/:id/chat
 * Payload: { message: string }
 * Action:
   * Verify threadId exists.
   * Update status to RUNNING.
   * ASYNC: Invoke Claude Agent SDK.
     * On Tool execution (Write File): Next.js will likely restart here.
     * On Agent Idle: Execute git add . && git commit -m "Auto: {message_snippet}".
     * Update lastCommitHash.
     * Update status to IDLE.
 * Response: { status: 'RUNNING' } (Return immediately, do not wait for agent).
GET /threads/:id
 * Action: Return full thread object (status, history, last commit).
 * Use Case: Client polling for updates or re-hydrating after HMR.
POST /threads/:id/merge
 * Action:
   * git checkout main
   * git merge feat/vibe-{threadId}
   * git push origin main
 * Response: { success: true }
2.4 Agent SDK Integration Details
 * System Prompt: Do not inject file contents. Inject instructions only.
   * "You are a coding assistant modifying the local codebase."
   * "Use ls and grep to explore the codebase."
   * "Always run tsc or a build check if unsure before finishing."
 * Tools: Enable FileSystem, Bash.
 * Permissions: Run in "Auto" mode (no human confirmation required for file writes) since we are protected by Git branches.
3. Package 2: @vibecoder/client
Role: The Interface. Embeddable into the user's Next.js App.
Tech Stack: React, Next.js Server Actions.
3.1 Directory Structure
/src
  /components
    VibeOverlay.tsx  <-- The UI
  /actions
    proxy.ts         <-- The Bridge
  /index.ts          <-- Exports

3.2 Security (The Password Gate)
 * Logic:
   * Check process.env.VIBE_PASSWORD on server.
   * If not set, disable Vibe Coder (or warn).
   * If set, VibeOverlay checks for a session cookie vibe-auth.
   * If no cookie, render <LockScreen />.
   * User enters password -> Server Action verifies -> Sets HTTPOnly cookie.
3.3 Server Action: proxy.ts
This acts as a secure tunnel. The browser cannot talk to :3001 directly (CORS/Security).
'use server'
import { cookies } from 'next/headers'

const CONTROL_PLANE_URL = 'http://127.0.0.1:3001';

export async function sendPrompt(threadId: string, message: string) {
  // 1. Validate Auth Cookie
  // 2. Fetch Control Plane
  const res = await fetch(`${CONTROL_PLANE_URL}/threads/${threadId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
  return res.json();
}

export async function getThreadState(threadId: string) {
  // Same logic, GET request
}

3.4 Component: VibeOverlay.tsx
 * Mount Logic:
   * Check localStorage.getItem('vibe_active_thread_id').
   * If exists, immediately call getThreadState(id) via Server Action.
   * This handles the HMR/Page Reload scenario.
 * Rendering:
   * Fixed position bottom-4 right-4.
   * Maximize/Minimize toggle.
   * Chat Interface (User msg / Agent msg).
   * "Thinking" indicator when status === RUNNING.
4. Integration & Development Experience (DevX)
4.1 CLI Runner
The user should not run two commands manually. Create a bin script in @vibecoder/control-plane.
bin/vibe-dev.js:
#!/usr/bin/env node
const { spawn } = require('child_process');

// 1. Start the Control Plane
const cp = spawn('node', ['server.js'], { stdio: 'inherit' });

// 2. Start Next.js
const next = spawn('next', ['dev'], { stdio: 'inherit' });

// Handle exit
process.on('SIGINT', () => {
  cp.kill();
  next.kill();
});

4.2 User Installation
 * npm install @vibecoder/client @vibecoder/control-plane --save-dev
 * Add to layout.tsx:
   import { VibeOverlay } from '@vibecoder/client';

export default function Layout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === 'development' && <VibeOverlay />}
      </body>
    </html>
  )
}

 * Add VIBE_PASSWORD=1234 to .env.local.
 * Run npx vibe-dev.
5. Critical Edge Cases (Instructions for Agent)
 * Git Lock: If the Next.js watcher and the Control Plane Git logic fight over the .git/index.lock, the Control Plane must implement a retry mechanism for git commands with exponential backoff.
 * Port Conflict: If 3001 is taken, fail fast with a clear error message: "Vibe Coder requires port 3001".
 * Lost State: If the Control Plane crashes, the Client will receive connection refused errors. The Client UI must show a "Disconnected - Restart Terminal" badge.
6. Implementation Checklist for Agent
 * [ ] Repo Setup: Initialize monorepo with npm workspaces.
 * [ ] Control Plane: Scaffold Fastify server + simple-git wrapper.
 * [ ] Control Plane: Implement the Thread state machine.
 * [ ] Control Plane: Integrate ClaudeAgentClient. Crucial: Ensure cwd is passed correctly.
 * [ ] Client: Build proxy.ts Server Actions with error handling for fetch failures.
 * [ ] Client: Build VibeOverlay.tsx with polling interval (e.g., 2 seconds) when status is RUNNING.
 * [ ] Glue: Create the vibe-dev runner script.
 * [ ] 
