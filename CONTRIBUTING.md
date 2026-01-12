# Contributing to Vibe Coder

Thank you for your interest in contributing to Vibe Coder! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Git

### Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/vibecoder.git
   cd vibecoder
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Build the packages:
   ```bash
   pnpm build
   ```

## Development Workflow

### Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm lint` | Run ESLint |
| `pnpm clean` | Clean build artifacts |

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Ensure all checks pass:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm build
   ```

4. Commit your changes with a descriptive message

5. Push to your fork and open a Pull Request

## Code Style

- We use TypeScript with strict mode enabled
- ESLint is configured with recommended rules
- No `any` types - use proper typing
- Use `type` imports for type-only imports
- React components should use functional components with hooks

## Project Structure

```
packages/
├── client/          # @vibecoder/client - React overlay & implementations
│   └── src/
│       ├── components/   # React components
│       ├── lib/          # Implementation functions
│       └── types.ts      # TypeScript types
│
└── control-plane/   # @vibecoder/control-plane - Node.js server
    └── src/
        ├── server.ts     # Fastify server
        ├── agent.ts      # Claude SDK integration
        ├── git.ts        # Git operations
        └── threads.ts    # Thread state machine
```

## Security Considerations

Vibe Coder is a **development-only tool**. When contributing:

- Never remove production safeguards
- Don't expose sensitive operations to the client
- Keep the control plane localhost-only
- Maintain the authentication layer

## Questions?

Open an issue if you have questions or need help getting started.
