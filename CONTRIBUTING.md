# Contributing to Persona POS

Thank you for your interest in contributing to Persona POS! This document provides guidelines and information for contributors.

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
   git clone https://github.com/YOUR_USERNAME/persona-pos.git
   cd persona-pos
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

Persona POS uses a clean architecture with ports (interfaces) and adapters (implementations). Here's how to add new adapters:

### 1. Database Adapter

```bash
# Create new adapter file
touch src/adapters/db/YourDBAdapter.ts
```

```typescript
// src/adapters/db/YourDBAdapter.ts
import { DBPort } from '../../core/ports/DBPort';

export class YourDBAdapter implements DBPort {
  private config: YourConfigType;

  constructor(config: YourConfigType) {
    this.config = config;
  }

  // Implement all DBPort methods
  async getAllItems(): Promise<Item[]> {
    // Your implementation
  }

  // ... other methods
}
```

**Register in DI container** (`src/lib/di.ts`):

```typescript
case 'your-db':
  this.dbPort = new YourDBAdapter(config);
  break;
```

**Update config schema** (`src/lib/config.ts`):

```typescript
adapter: z.enum(['indexeddb', 'sqlite', 'postgres', 'your-db'])
```

**Add documentation** in `CONFIGURATION.md`

### 2. Auth Adapter

Similar process - implement `AuthPort` interface:

```typescript
// src/adapters/auth/YourAuthAdapter.ts
import { AuthPort } from '../../core/ports/AuthPort';

export class YourAuthAdapter implements AuthPort {
  // Implement signIn, signOut, getSession, etc.
}
```

### 3. Email Adapter

Implement `EmailPort`:

```typescript
// src/adapters/email/YourEmailAdapter.ts
import { EmailPort } from '../../core/ports/EmailPort';

export class YourEmailAdapter implements EmailPort {
  async sendEmail(message: EmailMessage): Promise<Result> {
    // Your implementation
  }
}
```

### 4. SMS Adapter

Implement `SmsPort`:

```typescript
// src/adapters/sms/YourSmsAdapter.ts
import { SmsPort } from '../../core/ports/SmsPort';

export class YourSmsAdapter implements SmsPort {
  async sendSms(message: SmsMessage): Promise<Result> {
    // Your implementation
  }
}
```

### 5. Storage Adapter

Implement `StoragePort`:

```typescript
// src/adapters/storage/YourStorageAdapter.ts
import { StoragePort } from '../../core/ports/StoragePort';

export class YourStorageAdapter implements StoragePort {
  async put(key: string, data: Blob): Promise<Result> {
    // Your implementation
  }
  
  async get(key: string): Promise<Blob | null> {
    // Your implementation
  }
}
```

### Testing Your Adapter

1. Add unit tests in `src/adapters/__tests__/`
2. Test via settings UI (/admin/settings)
3. Add integration tests if applicable

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
persona-pos/
├── src/
│   ├── core/              # Domain models and ports (interfaces)
│   │   ├── models/        # TypeScript types
│   │   └── ports/         # Interface definitions
│   ├── adapters/          # Concrete implementations
│   │   ├── db/            # Database adapters
│   │   ├── auth/          # Auth adapters
│   │   ├── email/         # Email adapters
│   │   ├── sms/           # SMS adapters
│   │   └── storage/       # Storage adapters
│   ├── components/        # React components
│   ├── pages/             # Route pages
│   ├── lib/               # Utilities
│   │   ├── di.ts          # Dependency injection
│   │   └── config.ts      # Configuration
│   └── hooks/             # Custom React hooks
├── config/                # YAML configuration files
└── public/                # Static assets
```

## Need Help?

- **Documentation**: Check `CONFIGURATION.md` and `README.md`
- **Issues**: Browse [existing issues](https://github.com/yourorg/persona-pos/issues)
- **Discussions**: Join [GitHub Discussions](https://github.com/yourorg/persona-pos/discussions)
- **Discord**: [Join our community](https://discord.gg/persona-pos)

## License

By contributing to Persona POS, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Persona POS! 🎉
