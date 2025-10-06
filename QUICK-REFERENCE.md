# Quick Reference Guide

**One-page reference for developers working on Persona POS**

---

## 📁 Project Structure

```
persona-pos/
├── src/
│   ├── core/               # Domain layer (interfaces & models)
│   │   ├── ports/          # Interfaces (DBPort, AuthPort, etc.)
│   │   └── models/         # Type definitions
│   ├── adapters/           # Implementations of ports
│   │   ├── db/             # Database adapters
│   │   ├── auth/           # Auth adapters
│   │   ├── email/          # Email adapters
│   │   ├── sms/            # SMS adapters
│   │   └── storage/        # Storage adapters
│   ├── lib/                # Utilities
│   │   ├── di.ts           # Dependency injection
│   │   ├── config.ts       # Configuration management
│   │   ├── db.ts           # IndexedDB implementation
│   │   ├── auth.ts         # Auth utilities
│   │   └── db-operations.ts # DB operations
│   ├── pages/              # Route components
│   ├── components/         # React components
│   │   └── ui/             # shadcn/ui components
│   └── hooks/              # Custom React hooks
├── config/                 # YAML configuration
├── backend/                # Backend API (to be created)
├── migrations/             # Database migrations (to be created)
└── docs/                   # Documentation
```

---

## 🚀 Common Commands

### Development
```bash
npm run dev              # Start dev server (port 8080)
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint
npm run typecheck        # TypeScript type checking
```

### Database (Future)
```bash
npm run migrate          # Run migrations
npm run migrate:rollback # Rollback last migration
npm run seed             # Seed database with sample data
```

### Testing (Future)
```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests only
npm run test:e2e         # E2E tests only
npm run test:coverage    # Coverage report
```

### Docker
```bash
docker-compose up -d              # Start all services
docker-compose down               # Stop all services
docker-compose logs -f [service]  # View logs
docker-compose restart [service]  # Restart service
docker-compose ps                 # List services
```

---

## 🔌 Adding a New Adapter

### 1. Create Adapter File

```typescript
// src/adapters/db/MyDBAdapter.ts
import { DBPort } from '../../core/ports/DBPort';

export class MyDBAdapter implements DBPort {
  private config: MyConfig;

  constructor(config: MyConfig) {
    this.config = config;
  }

  // Implement all DBPort methods
  async getAllItems(): Promise<Item[]> {
    // Your implementation
  }
  
  // ... other methods
}
```

### 2. Register in DI Container

```typescript
// src/lib/di.ts
import { MyDBAdapter } from '../adapters/db/MyDBAdapter';

// In getDB() method:
case 'mydb':
  this.dbPort = new MyDBAdapter(config);
  break;
```

### 3. Update Config Schema

```typescript
// src/lib/config.ts
database: z.object({
  adapter: z.enum(['indexeddb', 'sqlite', 'postgres', 'mydb']),
  // ...
})
```

### 4. Document It

Add section to `CONFIGURATION.md` explaining how to configure your adapter.

---

## 🗄️ Database Schema (Current)

### Products
```typescript
{
  id: string;
  name: string;
  description?: string;
  category: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants: ProductVariant[];
  createdAt: number;
  updatedAt: number;
}
```

### Orders
```typescript
{
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
}
```

### Users
```typescript
{
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  roleIds: string[];
  status: 'active' | 'inactive';
  lastLoginAt?: number;
  createdAt: number;
}
```

### Roles
```typescript
{
  id: string;
  name: string;
  systemRole?: 'admin' | 'supervisor' | 'reporter' | 'standard';
  permissions: RolePermissions;
}
```

**See:** `src/lib/db.ts` for complete schema

---

## 🔐 Permission System

### System Roles
- **admin** - Full access to everything
- **supervisor** - Manage inventory, services, customers; view reports
- **reporter** - View-only access to reports and inventory
- **standard** - POS operations only

### Permission Domains
- `inventory` - Products and stock
- `reports` - Sales reports
- `exports` - Data export
- `settings` - System settings
- `users` - User management
- `services` - Service catalog
- `customers` - Customer database

### Permission Actions
- `read` - View data
- `write` - Create/update data
- `delete` - Delete data

### Check Permission
```typescript
import { hasPermission } from '@/lib/auth';

const session = getCurrentSession();
if (hasPermission(session, 'inventory', 'write')) {
  // Allow editing inventory
}
```

---

## 🎨 UI Components

### Using shadcn/ui Components

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>My Card</CardTitle>
  </CardHeader>
  <CardContent>
    <Input placeholder="Enter text" />
    <Button>Submit</Button>
  </CardContent>
</Card>
```

### Adding New shadcn/ui Component

```bash
npx shadcn-ui@latest add [component-name]
```

Example:
```bash
npx shadcn-ui@latest add dropdown-menu
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Database
VITE_DB_ADAPTER=indexeddb|sqlite|postgres
VITE_DB_HOST=localhost
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=postgres
VITE_DB_PASSWORD=password

# Auth
VITE_AUTH_ADAPTER=local|google|oidc
VITE_AUTH_SESSION_DURATION=86400000

# Email
VITE_EMAIL_ADAPTER=console|smtp|resend
VITE_EMAIL_FROM=noreply@example.com

# Features
VITE_FEATURE_REPORTS=true
VITE_FEATURE_EMAIL=false
VITE_FEATURE_SMS=false
```

### Config Files

1. `config/default.yml` - Default config
2. `config/local.yml` - Local overrides (gitignored)
3. `.env.local` - Environment variables (gitignored)

**Priority:** Environment variables > local.yml > default.yml

---

## 🐛 Debugging

### View Logs

**Browser Console:**
- Open DevTools (F12)
- Check Console tab for errors
- Check Network tab for API calls

**Backend Logs (Future):**
```bash
# Linux
sudo journalctl -u persona-pos -f

# Windows
Get-EventLog -LogName Application -Source PersonaPOS -Newest 50

# Docker
docker-compose logs -f backend
```

### Common Issues

**Port already in use:**
```bash
# Linux
sudo lsof -i :8080
sudo kill -9 [PID]

# Windows
Get-NetTCPConnection -LocalPort 8080
Stop-Process -Id [PID] -Force
```

**Database connection failed:**
- Check `.env.local` credentials
- Ensure database service is running
- Test connection manually

**Build fails:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📝 Code Style

### TypeScript
```typescript
// ✅ Good
interface User {
  id: string;
  name: string;
}

async function getUser(id: string): Promise<User | null> {
  // ...
}

// ❌ Bad
function getUser(id: any): any {
  // ...
}
```

### React Components
```typescript
// ✅ Good - Functional component with types
interface Props {
  title: string;
  onSubmit: () => void;
}

export default function MyComponent({ title, onSubmit }: Props) {
  return <div>{title}</div>;
}

// ❌ Bad - No types
export default function MyComponent({ title, onSubmit }) {
  return <div>{title}</div>;
}
```

### Naming Conventions
- **Components:** PascalCase (`UserCard.tsx`)
- **Files:** kebab-case (`db-operations.ts`)
- **Variables:** camelCase (`userName`)
- **Constants:** UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Interfaces:** PascalCase (`UserProfile`)

---

## 🧪 Testing (Future)

### Unit Test Example
```typescript
import { describe, it, expect } from 'vitest';
import { MyAdapter } from './MyAdapter';

describe('MyAdapter', () => {
  it('should connect successfully', async () => {
    const adapter = new MyAdapter(config);
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
  });
});
```

### E2E Test Example
```typescript
import { test, expect } from '@playwright/test';

test('complete checkout flow', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="add-to-cart"]');
  await page.click('[data-testid="checkout"]');
  await expect(page.locator('.receipt')).toBeVisible();
});
```

---

## 🔗 Important Links

### Documentation
- [Installation Guide](INSTALL.md)
- [Configuration Guide](CONFIGURATION.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Development Roadmap](ROADMAP.md)
- [Development Summary](DEVELOPMENT-SUMMARY.md)

### External Resources
- [React Docs](https://react.dev/)
- [TypeScript Docs](https://www.typescriptlang.org/docs/)
- [Vite Docs](https://vitejs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/docs)

### Community
- GitHub: https://github.com/yourorg/persona-pos
- Discord: https://discord.gg/persona-pos
- Discussions: https://github.com/yourorg/persona-pos/discussions

---

## 🚨 Emergency Procedures

### System Down
1. Check service status: `systemctl status persona-pos`
2. Check logs: `journalctl -u persona-pos -n 100`
3. Restart service: `systemctl restart persona-pos`
4. If still down, check database connection
5. Check disk space: `df -h`

### Database Corruption
1. Stop application
2. Restore from backup: `./scripts/restore.sh [backup_file]`
3. Restart application
4. Verify data integrity

### Lost Admin Access
1. Connect to database directly
2. Reset admin password:
   ```sql
   UPDATE users 
   SET password_hash = '[bcrypt_hash_of_new_password]'
   WHERE email = 'admin@example.com';
   ```
3. Log in with new password

---

## 💡 Tips & Tricks

### Fast Development
- Use `npm run dev` with hot reload
- Keep DevTools open for instant feedback
- Use React DevTools extension
- Use TypeScript strict mode

### Performance
- Lazy load routes: `const Page = lazy(() => import('./Page'))`
- Memoize expensive computations: `useMemo()`
- Debounce search inputs
- Use virtual scrolling for large lists

### Security
- Never commit `.env.local`
- Never commit `config/local.yml`
- Always validate user input
- Use parameterized queries
- Hash passwords with bcrypt (cost ≥ 10)

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "feat: add my feature"

# Push and create PR
git push origin feature/my-feature
```

### Conventional Commits
```
feat: add new feature
fix: fix bug
docs: update documentation
style: format code
refactor: refactor code
test: add tests
chore: update dependencies
```

---

## 📞 Getting Help

1. **Check documentation** - Most answers are here
2. **Search issues** - Someone may have had the same problem
3. **Ask in Discord** - Community can help
4. **Create issue** - If it's a bug or feature request
5. **Email support** - support@persona-pos.dev

---

**Last Updated:** January 15, 2025  
**Version:** 1.0
