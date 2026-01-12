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
export * from "@vibecoder/client/server-actions";
```

This re-exports all the pre-built server actions with authentication handling included. The library uses your `VIBE_PASSWORD` environment variable and manages sessions via HTTP-only cookies.

### 4. Add the overlay to your layout

Update `app/layout.tsx`:

```tsx
import { VibeOverlay } from "@vibecoder/client";
import * as vibeActions from "./actions/vibe";

export default function RootLayout({ children }: { children: React.ReactNode }) {
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

> **Note:** You don't need to wrap VibeOverlay in a `NODE_ENV` check - it automatically disables itself in production.

### 5. Run with the CLI

```bash
npx vibe-dev
```

This starts both the Control Plane (port 3001) and Next.js (port 3000).

---

## Features

- **Isolated Git Branches** - Each session creates a new branch (`feat/vibe-{id}`)
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

```bash
pnpm install
pnpm build
pnpm typecheck
```

## License

MIT

---

For technical architecture details, see [Design.md](./Design.md).
