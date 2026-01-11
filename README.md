# Vibe Coder

An AI-powered coding assistant that runs as a sidecar to your Next.js application. It uses Claude to make changes to your codebase on isolated Git branches, keeping your main branch safe.

## Quick Start

### 1. Install packages

```bash
pnpm add -D @vibecoder/client @vibecoder/control-plane
```

### 2. Add environment variables

Create or update `.env.local`:

```env
VIBE_PASSWORD=your_secret_password
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### 3. Create server actions

Create `app/actions/vibe.ts`:

```typescript
"use server";

import { cookies } from "next/headers";
import {
  createThreadImpl,
  getThreadStateImpl,
  sendPromptImpl,
  mergeThreadImpl,
  pushThreadImpl,
  checkHealthImpl,
  listThreadsImpl,
  switchThreadImpl,
} from "@vibecoder/client/lib/controlPlane";

const AUTH_COOKIE = "vibe-auth";

// Auth actions
export async function authenticate(password: string) {
  if (password !== process.env.VIBE_PASSWORD) {
    return { success: false, error: "Invalid password" };
  }
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, "authenticated", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 24,
  });
  return { success: true };
}

export async function checkAuth() {
  if (!process.env.VIBE_PASSWORD) {
    return { authenticated: false, configured: false };
  }
  const cookieStore = await cookies();
  const auth = cookieStore.get(AUTH_COOKIE);
  return { authenticated: auth?.value === "authenticated", configured: true };
}

// Wrap each action with auth check
async function withAuth<T>(fn: () => Promise<T>): Promise<T> {
  const { authenticated } = await checkAuth();
  if (!authenticated) {
    return { success: false, error: "Not authenticated" } as T;
  }
  return fn();
}

// Control plane actions
export const createThread = () => withAuth(() => createThreadImpl());
export const getThreadState = (id: string) => withAuth(() => getThreadStateImpl(id));
export const sendPrompt = (id: string, msg: string) => withAuth(() => sendPromptImpl(id, msg));
export const mergeThread = (id: string) => withAuth(() => mergeThreadImpl(id));
export const pushThread = (id: string) => withAuth(() => pushThreadImpl(id));
export const checkHealth = () => checkHealthImpl(); // No auth needed
export const listThreads = () => withAuth(() => listThreadsImpl());
export const switchThread = (id: string) => withAuth(() => switchThreadImpl(id));
```

### 4. Add the overlay to your layout

Update `app/layout.tsx`:

```tsx
import { VibeOverlay } from "@vibecoder/client";
import {
  authenticate,
  checkAuth,
  createThread,
  getThreadState,
  sendPrompt,
  mergeThread,
  pushThread,
  checkHealth,
  listThreads,
  switchThread,
} from "./actions/vibe";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <VibeOverlay
          actions={{
            authenticate,
            checkAuth,
            createThread,
            getThreadState,
            sendPrompt,
            mergeThread,
            pushThread,
            checkHealth,
            listThreads,
            switchThread,
          }}
        />
      </body>
    </html>
  );
}
```

> **Note:** You don't need to wrap VibeOverlay in a `NODE_ENV` check - it automatically disables itself in production for security.
```

### 5. Run with the CLI

```bash
npx vibe-dev
```

This starts both the Control Plane (port 3001) and Next.js (port 3000).

---

## How It Works

1. **Control Plane** (`@vibecoder/control-plane`) - A standalone Node.js server that:
   - Runs the Claude AI agent with filesystem and bash access
   - Manages Git branches for each coding session
   - Auto-commits changes made by the AI
   - Survives Next.js HMR restarts

2. **Client** (`@vibecoder/client`) - A React overlay that:
   - Provides a chat interface to interact with Claude
   - Shows which Git branch you're working on
   - Allows switching between multiple sessions
   - Handles authentication with a password gate

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Your Next.js App (Port 3000)                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │  VibeOverlay Component                            │  │
│  │  - Chat UI                                        │  │
│  │  - Branch switching                               │  │
│  │  - Auth gate                                      │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                   Server Actions                        │
│                          │                              │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Control Plane (Port 3001)  [STATEFUL]                  │
│  - Claude Agent SDK                                     │
│  - Git operations (async)                               │
│  - File I/O                                             │
│  - Thread state management                              │
└─────────────────────────────────────────────────────────┘
```

### Communication Model

The Control Plane is **stateful** and survives HMR restarts. The communication model is designed around this:

1. **Commands return immediately** - All mutating operations (create thread, send message, merge, switch, push) return as soon as the command is acknowledged. The actual work happens asynchronously in the background.

2. **Client polls for state** - The client regularly polls `GET /threads/:id` to get the current thread state, including any operation in progress.

3. **Client is stateless** - The Next.js app can restart at any time (HMR, crashes, manual refresh). All state is recovered by polling the Control Plane.

This design ensures that:
- Git operations that trigger HMR don't block the response
- The UI stays responsive during long-running AI operations
- State is never lost when the app restarts

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VIBE_PASSWORD` | Yes | - | Password to access the overlay |
| `ANTHROPIC_API_KEY` | Yes | - | Your Anthropic API key |
| `VIBE_PORT` | No | `3001` | Control plane port |
| `VIBE_CONTROL_PLANE_URL` | No | `http://127.0.0.1:3001` | Control plane URL |

## Security

Vibe Coder is designed as a **development-only tool** with multiple layers of security:

### Automatic Production Protection

1. **Component Level**: `VibeOverlay` automatically returns `null` in production - even if you forget to conditionally render it
2. **API Level**: All implementation functions (`*Impl`) refuse to execute in production
3. **Server Level**: Control plane only binds to `127.0.0.1` (localhost)
4. **Auth Level**: Password protection via HTTP-only cookies

### What happens in production?

- The overlay **will not render** (returns null)
- API calls **will fail** with security error
- Control plane **won't be running** anyway
- Zero security exposure to end users

### Override (Not Recommended)

If you absolutely must use in production (e.g., staging environment):

```tsx
<VibeOverlay
  actions={actions}
  dangerouslyAllowProduction={true}  // ⚠️ SECURITY RISK
/>
```

And in your server actions:

```typescript
createThreadImpl({ dangerouslyAllowProduction: true })
```

## Features

- **Isolated Git Branches**: Each coding session creates a new branch (`feat/vibe-{id}`)
- **Auto-commit**: Changes are automatically committed after each AI response
- **Branch Switching**: Switch between multiple unfinished sessions
- **Push to Remote**: Push your branch to create PRs or share work-in-progress
- **Merge to Main**: One-click merge when you're happy with changes
- **HMR Resilient**: Control plane survives Next.js hot reloads
- **Password Protected**: Simple password gate for development security
- **Git Lock Handling**: Automatic retry with exponential backoff for Git operations
- **Production Safe**: Automatically disabled in production environments

## API Reference

### VibeOverlay Props

```typescript
interface VibeOverlayProps {
  actions: VibeActions;
}

interface VibeActions {
  authenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
  checkAuth: () => Promise<{ authenticated: boolean; configured: boolean }>;
  createThread: () => Promise<ActionResult<CreateThreadResult>>;
  getThreadState: (threadId: string) => Promise<ActionResult<ThreadState>>;
  sendPrompt: (threadId: string, message: string) => Promise<ActionResult<ChatResult>>;
  mergeThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  pushThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
  checkHealth: () => Promise<ActionResult<{ status: string; workingDir: string }>>;
  listThreads: () => Promise<ActionResult<ThreadState[]>>;
  switchThread: (threadId: string) => Promise<ActionResult<MergeResult>>;
}

// All mutating operations (createThread, sendPrompt, mergeThread, pushThread, switchThread)
// return immediately with acknowledgment. Poll getThreadState for completion.
```

### Implementation Functions

The package exports implementation functions that your server actions should delegate to:

```typescript
import {
  createThreadImpl,
  getThreadStateImpl,
  sendPromptImpl,
  mergeThreadImpl,
  pushThreadImpl,
  checkHealthImpl,
  listThreadsImpl,
  switchThreadImpl,
} from "@vibecoder/client/lib/controlPlane";
```

Each function accepts an optional config object:

```typescript
interface ControlPlaneConfig {
  url?: string; // Override the control plane URL
  dangerouslyAllowProduction?: boolean; // Allow running in production (NOT RECOMMENDED)
}
```

**Async Operations**: The mutating functions (`createThreadImpl`, `sendPromptImpl`, `mergeThreadImpl`, `pushThreadImpl`, `switchThreadImpl`) return immediately after the command is acknowledged. The actual work happens asynchronously in the control plane. Use `getThreadStateImpl` to poll for completion by checking the `operation` field.

## Development

### Building from source

```bash
pnpm install
pnpm build
```

### Running tests

```bash
pnpm typecheck
```

## License

MIT
