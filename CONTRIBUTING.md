# Contributing to StewardPOS

Thank you for your interest in contributing to StewardPOS! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Commit Convention](#commit-convention)
- [Adding New Adapters](#adding-new-adapters)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and professional in all interactions.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/stewardpos.git
   cd stewardpos
   ```
3. **Install dependencies**:
   ```bash
   npm install
   # or
   pnpm install
   # or
   bun install
   ```
4. **Copy environment file**:
   ```bash
   cp .env.example .env.local
   ```
5. **Start development server**:
   ```bash
   npm run dev
   ```

## Development Workflow

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. Make your changes following our [code style](#code-style)

3. Test your changes thoroughly

4. Commit your changes using our [commit convention](#commit-convention)

5. Push to your fork and submit a pull request

## Code Style

We use ESLint and Prettier for code formatting. Run before committing:

```bash
npm run lint        # Check for linting errors
npm run format      # Auto-format code
npm run typecheck   # TypeScript type checking
```

### Key Guidelines

- **TypeScript**: Use strict typing, avoid `any`
- **React**: Use functional components with hooks
- **Naming**:
  - Components: PascalCase (`UserCard.tsx`)
  - Files: kebab-case for utilities (`config-utils.ts`)
  - Variables: camelCase (`userName`)
  - Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Imports**: Group by external → internal → relative
- **Comments**: Explain *why*, not *what*

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process, dependencies, tooling

### Examples

```bash
feat(adapters): add SQLite database adapter

Implement SQLite adapter with full CRUD operations.
Supports file-based storage for on-premise deployments.

Closes #123
```

```bash
fix(auth): handle expired sessions gracefully

Previously expired sessions caused app crash.
Now redirects to login page with clear message.

Fixes #456
```

## Adding New Adapters

Two extension points exist, and both are **server-side**. If you are looking for
`src/adapters/` or `src/lib/di.ts` in the frontend, they are gone — Phase 1
removed the browser-side IndexedDB/DI layer, and every page now reaches the API
through `src/lib/api/`. This section used to describe that deleted architecture,
which would have sent a contributor looking for files that do not exist.

### Payment terminals

`backend/src/terminal/TerminalPort.ts` is the interface; there are six
implementations beside it, and `TerminalAdapterFactory.ts` selects one from
store settings.

```typescript
// backend/src/terminal/YourTerminalAdapter.ts
import { TerminalPort, ChargeResult, ChargeMeta } from './TerminalPort';

export class YourTerminalAdapter implements TerminalPort {
  createCharge(amount: number, currency: string, meta: ChargeMeta): Promise<ChargeResult>;
  getChargeStatus(chargeId: string): Promise<ChargeResult>;
  cancelCharge(chargeId: string): Promise<void>;
  listReaders(): Promise<TerminalReader[]>;
  testConnection(): Promise<ConnectionTestResult>;
}
```

Register it in `TerminalAdapterFactory`, and add it to the provider list in
`src/pages/admin/AdminSettings.tsx`.

**`amount` is integer cents.** Every adapter is handed the figure the server
computed; none of them may re-derive it from anything the client sent. Read
`backend/src/services/pricing.ts` before touching money.

Note that adding an adapter is the easy part. Only Manual (cash) and Stripe are
in v1, and the rest are flagged off, because a terminal integration is not done
until it has been exercised against real hardware — see the backlog in
`docs/masterplan/phase-9-golive.md`.

### Email

`backend/src/services/email.ts` dispatches on `config.email.adapter`
(`console`, `smtp`, `resend`). Add a `case` and a sender.

The `console` adapter returns `logged`, deliberately **not** `sent`. Keep that
distinction in anything you add: this project previously recorded receipts as
delivered when nothing had been sent, and a shop reading its own send history
saw evidence that was not true.

### Storage

`STORAGE_ADAPTER` selects between the volume-backed disk path (the default) and
S3-compatible object storage. See `docs/guides/deploy-alternatives.md`.

### Testing Your Adapter

1. Add unit tests beside the adapter, in `backend/src/terminal/__tests__/`
2. Exercise it through **Admin → Settings → Payments**, including
   "Test connection"
3. If it touches the database, add an integration test in
   `backend/src/adapters/db/__tests__/integration/` — those run against a real
   Postgres and have repeatedly caught what a mocked adapter accepted

## Pull Request Process

1. **Update documentation** if you've changed APIs or added features

2. **Add tests** for new functionality

3. **Run all checks**:
   ```bash
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```

4. **Update CHANGELOG.md** if applicable

5. **Fill out PR template**:
   - Description of changes
   - Related issues
   - Screenshots (if UI changes)
   - Breaking changes
   - Testing done

6. **Request review** from maintainers

7. **Address feedback** and push updates

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Commits follow conventional commit format
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] No console errors or warnings
- [ ] Builds successfully
- [ ] Backwards compatible (or breaking changes documented)

## Testing

```bash
# Run tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place tests next to the code they test or in `__tests__` directories
- Name test files: `*.test.ts` or `*.test.tsx`
- Use descriptive test names
- Follow AAA pattern: Arrange, Act, Assert

Example:

```typescript
import { describe, it, expect } from 'vitest';
import { YourAdapter } from './YourAdapter';

describe('YourAdapter', () => {
  it('should handle connection correctly', async () => {
    // Arrange
    const adapter = new YourAdapter(config);
    
    // Act
    const result = await adapter.testConnection();
    
    // Assert
    expect(result.success).toBe(true);
  });
});
```

## Project Structure

```
stewardpos/
├── src/                      # Frontend (Vite + React + TypeScript)
│   ├── components/           # Shared components; ui/ is shadcn
│   ├── pages/                # Route pages, incl. admin/
│   ├── hooks/queries/        # TanStack Query hooks
│   └── lib/
│       ├── api/              # The typed API SDK — the only way to the backend
│       ├── api-client.ts     # fetch wrapper; unwraps the response envelope
│       └── register-math.ts  # Register arithmetic
├── backend/                  # Express API
│   ├── src/api/routes/       # One module per resource
│   ├── src/api/middleware/   # authenticate, authorize, errors, logging
│   ├── src/services/         # pricing, discounts, returns, reports, email, migrator, seeder
│   ├── src/adapters/db/      # PostgresAdapter, SQLiteAdapter — the hand-written SQL
│   ├── src/terminal/         # Payment terminal adapters (TerminalPort)
│   └── migrations/           # postgres/ and sqlite/, kept in lock-step
├── e2e/                      # Playwright specs
├── docs/
│   ├── guides/               # Operator documentation
│   ├── masterplan/           # The build plan and its completion notes
│   └── reference/            # Environment variables
└── scripts/                  # backup, restore, deploy, load test
```

**Read `docs/masterplan/` before a substantial change.** Each phase file carries
completion notes recording what was built, what it broke, and what was
deliberately left undone. It is the closest thing this project has to
institutional memory.

## Need Help?

- **Documentation**: `README.md`, then [docs/guides/](docs/guides/) for running it
  and `docs/masterplan/` for why it is the way it is
- **Issues**: [existing issues](https://github.com/24Skater/stewardpos/issues)
- **Security**: do not open an issue — see [SECURITY.md](SECURITY.md)

## License

By contributing to StewardPOS, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to StewardPOS! 🎉
