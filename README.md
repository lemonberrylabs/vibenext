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

import {
  authenticate as _authenticate,
  checkAuth as _checkAuth,
  createThread as _createThread,
  adoptThread as _adoptThread,
  getCurrentBranch as _getCurrentBranch,
  getThreadState as _getThreadState,
  sendPrompt as _sendPrompt,
  mergeThread as _mergeThread,
  pushThread as _pushThread,
  listThreads as _listThreads,
  switchThread as _switchThread,
  checkHealth as _checkHealth,
} from "@vibecoder/client/server-actions";

export async function authenticate(password: string) {
  return _authenticate(password);
}

export async function checkAuth() {
  return _checkAuth();
}

export async function createThread(baseBranch?: string) {
  return _createThread(baseBranch);
}

export async function adoptThread(branchName: string) {
  return _adoptThread(branchName);
}

export async function getCurrentBranch() {
  return _getCurrentBranch();
}

export async function getThreadState(id: string) {
  return _getThreadState(id);
}

export async function sendPrompt(id: string, message: string) {
  return _sendPrompt(id, message);
}

export async function mergeThread(id: string) {
  return _mergeThread(id);
}

export async function pushThread(id: string) {
  return _pushThread(id);
}

export async function listThreads() {
  return _listThreads();
}

export async function switchThread(id: string) {
  return _switchThread(id);
}

export async function checkHealth() {
  return _checkHealth();
}
```

> **Note:** Next.js 14+ requires explicit async function definitions in "use server" files. Re-exports like `export * from "..."` are not supported.

### 4. Add the overlay to your layout

Update `app/layout.tsx`:

```tsx
import { VibeOverlay } from "@vibecoder/client";
import {
  authenticate,
  checkAuth,
  createThread,
  adoptThread,
  getCurrentBranch,
  getThreadState,
  sendPrompt,
  mergeThread,
  pushThread,
  listThreads,
  switchThread,
  checkHealth,
} from "./actions/vibe";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <VibeOverlay actions={{
          authenticate,
          checkAuth,
          createThread,
          adoptThread,
          getCurrentBranch,
          getThreadState,
          sendPrompt,
          mergeThread,
          pushThread,
          listThreads,
          switchThread,
          checkHealth,
        }} />
      </body>
    </html>
  );
}
```

> **Note:** Pass individual functions as a plain object, not a module object. The overlay automatically disables itself in production.

### 5. Run with the CLI

```bash
npx vibe-dev
```

This starts both the Control Plane (port 3001) and Next.js (port 3000).

---

## Features

- **Isolated Git Branches** - Each session creates a new branch (`feat/vibe-{id}`)
- **Branch Selection** - Choose to start from main, branch from current, or continue on existing vibe branch
- **Auto-commit** - Changes are automatically committed after each AI response
- **Branch Switching** - Switch between multiple unfinished sessions
- **Push to Remote** - Push your branch to create PRs
- **Merge to Main** - One-click merge when you're happy with changes
- **HMR Resilient** - Control plane survives Next.js hot reloads
- **Production Safe** - Automatically disabled in production environments

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VIBE_PASSWORD` | Yes | - | Password to access the overlay |
| `ANTHROPIC_API_KEY` | Yes | - | Your Anthropic API key |
| `VIBE_PORT` | No | `3001` | Control plane port |
| `VIBE_CONTROL_PLANE_URL` | No | `http://127.0.0.1:3001` | Control plane URL |
| `VIBE_ANTHROPIC_MODEL` | No | `claude-opus-4-5` | Anthropic model to use |

## Security

Vibe Coder is a **development-only tool** with automatic production protection:

1. `VibeOverlay` returns `null` in production
2. All API functions refuse to execute in production
3. Control plane only binds to localhost (`127.0.0.1`)
4. Password authentication via HTTP-only cookies

**Override (not recommended):** For staging environments, pass `dangerouslyAllowProduction={true}` to `VibeOverlay` and `{ dangerouslyAllowProduction: true }` to implementation functions.

## Development

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build        # Build all packages
pnpm typecheck    # Type check without emitting
pnpm clean        # Clean all dist folders
```

### Local Development

To test changes locally in another project:

```bash
# In your Next.js project
pnpm add @vibecoder/client@file:../vibecoder/packages/client
pnpm add @vibecoder/control-plane@file:../vibecoder/packages/control-plane
```

Changes to the source are reflected after running `pnpm build` in the vibecoder repo (no reinstall needed with `file:` protocol).

### Publishing to npm

```bash
# Ensure you're logged in to npm
npm login

# Build all packages
pnpm build

# Publish (from repo root)
pnpm -r publish --access public
```

Or publish individually:

```bash
cd packages/client && npm publish --access public
cd packages/control-plane && npm publish --access public
```

### Versioning

Use [changesets](https://github.com/changesets/changesets) or manually bump versions in both `packages/client/package.json` and `packages/control-plane/package.json` before publishing.

## License

MIT

---

For technical architecture details, see [Design.md](./Design.md).
