# Configuration

Persona POS uses a flexible configuration system that supports multiple data sources:

1. **Default configuration** (`config/default.yml`) - Base configuration for all environments
2. **Local overrides** (`config/local.yml`) - Git-ignored file for local development overrides
3. **Environment variables** - Highest priority, prefixed with `VITE_`

## Configuration Priority

Environment variables > local.yml > default.yml

## Available Adapters

### Database
- `indexeddb` - Browser-based storage (default, no setup required)
- `sqlite` - File-based SQL database (requires backend)
- `postgres` - PostgreSQL database (requires backend)

### Authentication
- `local` - Email/password with bcrypt (default, built-in)
- `oidc` - Generic OpenID Connect provider
- `google` - Google OAuth 2.0

### Email
- `console` - Logs emails to browser console (default, no setup)
- `smtp` - Standard SMTP server (Gmail, SendGrid, etc.)
- `resend` - Resend API service

### SMS
- `console` - Logs SMS to browser console (default, no setup)
- `twilio` - Twilio SMS service

### Storage
- `localstorage` - Browser localStorage for assets (default)
- `s3` - Amazon S3 or S3-compatible (MinIO, DigitalOcean Spaces)
- `azure` - Azure Blob Storage

## Local Development

1. Copy `.env.example` to `.env.local`
2. Or create `config/local.yml` with your overrides
3. Restart the dev server

Example `config/local.yml`:

```yaml
database:
  adapter: indexeddb

auth:
  adapter: local

email:
  adapter: smtp
  from: dev@yourcompany.com
  config:
    host: smtp.gmail.com
    port: 587
    secure: false
    user: your-email@gmail.com
    password: your-app-password

features:
  email: true
```

## Production Deployment

Use environment variables for production secrets. Never commit `config/local.yml` or `.env.local`.

Example production env vars:
```bash
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=your-db-host.com
VITE_DB_PORT=5432
VITE_AUTH_ADAPTER=oidc
VITE_EMAIL_ADAPTER=resend
VITE_EMAIL_RESEND_API_KEY=re_xxxxx
VITE_FEATURE_EMAIL=true
VITE_FEATURE_SMS=true
```
