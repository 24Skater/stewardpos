# Configuration Guide

Complete reference for all configuration options in Persona POS.

## Table of Contents

- [Configuration Sources](#configuration-sources)
- [Database Adapters](#database-adapters)
- [Authentication Adapters](#authentication-adapters)
- [Email Adapters](#email-adapters)
- [SMS Adapters](#sms-adapters)
- [Storage Adapters](#storage-adapters)
- [Feature Flags](#feature-flags)
- [Environment Variables](#environment-variables)
- [Examples](#examples)

## Configuration Sources

Persona POS uses a three-tier configuration system:

1. **Default configuration** (`config/default.yml`) - Base config
2. **Local overrides** (`config/local.yml`) - Git-ignored, for local development
3. **Environment variables** - Highest priority (prefixed with `VITE_`)

**Priority**: Environment variables > `config/local.yml` > `config/default.yml`

## Database Adapters

### IndexedDB (Default - Browser Only)

No configuration needed. Best for demos and client-side applications.

```yaml
database:
  adapter: indexeddb
```

**Pros**: No setup, works in browser, offline-capable
**Cons**: Browser-only, limited storage, no server-side queries

### SQLite (File-based)

Requires backend. Ideal for single-user or small deployments.

```yaml
database:
  adapter: sqlite
  connection:
    filename: ./data/persona-pos.db
```

**Environment variables**:
```bash
VITE_DB_ADAPTER=sqlite
VITE_DB_FILENAME=./data/persona-pos.db
```

**Pros**: Simple, portable, no server needed
**Cons**: Single-writer, not suitable for high concurrency

### PostgreSQL

Production-ready relational database.

```yaml
database:
  adapter: postgres
  connection:
    host: localhost
    port: 5432
    database: persona_pos
    user: postgres
    password: your_password
```

**Environment variables**:
```bash
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=your-postgres-host.com
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=postgres
VITE_DB_PASSWORD=your_secure_password
```

**Pros**: Robust, scalable, ACID compliant, advanced features
**Cons**: Requires server setup and maintenance

## Authentication Adapters

### Local Auth (Default)

Built-in email/password authentication with bcrypt hashing.

```yaml
auth:
  adapter: local
  sessionDuration: 86400000  # 24 hours in milliseconds
```

**Environment variables**:
```bash
VITE_AUTH_ADAPTER=local
VITE_AUTH_SESSION_DURATION=86400000
```

**Features**:
- Bcrypt password hashing
- Session-based authentication
- Configurable session duration
- No external dependencies

### Google OAuth

OAuth 2.0 authentication via Google.

```yaml
auth:
  adapter: google
  config:
    clientId: your-google-client-id.apps.googleusercontent.com
    clientSecret: your-google-client-secret
    redirectUri: https://yourapp.com/auth/callback
```

**Environment variables**:
```bash
VITE_AUTH_ADAPTER=google
VITE_AUTH_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_AUTH_GOOGLE_CLIENT_SECRET=your-secret
VITE_AUTH_REDIRECT_URI=https://yourapp.com/auth/callback
```

**Setup**:
1. Create project in [Google Cloud Console](https://console.cloud.google.com/)
2. Enable Google+ API
3. Create OAuth 2.0 credentials
4. Add authorized redirect URIs

### OIDC (OpenID Connect)

Generic OIDC provider - works with Azure AD, Okta, Keycloak, Auth0, etc.

```yaml
auth:
  adapter: oidc
  config:
    issuer: https://your-issuer.com
    clientId: your-client-id
    clientSecret: your-client-secret
    redirectUri: https://yourapp.com/auth/callback
```

**Environment variables**:
```bash
VITE_AUTH_ADAPTER=oidc
VITE_AUTH_ISSUER=https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0
VITE_AUTH_CLIENT_ID=your-azure-client-id
VITE_AUTH_CLIENT_SECRET=your-azure-secret
VITE_AUTH_REDIRECT_URI=https://yourapp.com/auth/callback
```

**Azure AD Example**:
```bash
VITE_AUTH_ISSUER=https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0
VITE_AUTH_CLIENT_ID=12345678-1234-1234-1234-123456789abc
```

**Okta Example**:
```bash
VITE_AUTH_ISSUER=https://your-domain.okta.com
VITE_AUTH_CLIENT_ID=0oa1234567890abcdef
```

## Email Adapters

### Console (Default - Development)

Logs emails to browser console. No real emails sent.

```yaml
email:
  adapter: console
  from: noreply@example.com
```

**Environment variables**:
```bash
VITE_EMAIL_ADAPTER=console
VITE_EMAIL_FROM=noreply@example.com
```

### SMTP

Standard SMTP server (Gmail, SendGrid, Mailgun, etc.)

```yaml
email:
  adapter: smtp
  from: noreply@yourcompany.com
  config:
    host: smtp.gmail.com
    port: 587
    secure: false  # true for port 465
    user: your-email@gmail.com
    password: your-app-password
```

**Environment variables**:
```bash
VITE_EMAIL_ADAPTER=smtp
VITE_EMAIL_FROM=noreply@yourcompany.com
VITE_EMAIL_HOST=smtp.gmail.com
VITE_EMAIL_PORT=587
VITE_EMAIL_SECURE=false
VITE_EMAIL_USER=your-email@gmail.com
VITE_EMAIL_PASSWORD=your-app-password
```

**Gmail Setup**:
1. Enable 2-factor authentication
2. Generate app-specific password
3. Use app password in config

**SendGrid**:
```bash
VITE_EMAIL_HOST=smtp.sendgrid.net
VITE_EMAIL_PORT=587
VITE_EMAIL_USER=apikey
VITE_EMAIL_PASSWORD=your-sendgrid-api-key
```

### Resend

Modern email API service.

```yaml
email:
  adapter: resend
  from: onboarding@resend.dev
  config:
    apiKey: re_your_api_key
```

**Environment variables**:
```bash
VITE_EMAIL_ADAPTER=resend
VITE_EMAIL_FROM=onboarding@resend.dev
VITE_EMAIL_RESEND_API_KEY=re_123456789
```

## SMS Adapters

### Console (Default - Development)

Logs SMS to browser console. No real SMS sent.

```yaml
sms:
  adapter: console
  from: +1234567890
```

### Twilio

SMS via Twilio API.

```yaml
sms:
  adapter: twilio
  from: +1234567890
  config:
    accountSid: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    authToken: your-twilio-auth-token
```

**Environment variables**:
```bash
VITE_SMS_ADAPTER=twilio
VITE_SMS_FROM=+1234567890
VITE_SMS_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_SMS_TWILIO_AUTH_TOKEN=your-auth-token
```

## Storage Adapters

### LocalStorage (Default - Browser)

Browser localStorage for small assets.

```yaml
storage:
  adapter: localstorage
```

**Pros**: No setup, works offline
**Cons**: 5-10MB limit, browser-only

### S3 (AWS, MinIO, DigitalOcean Spaces, Wasabi)

S3-compatible object storage.

```yaml
storage:
  adapter: s3
  config:
    endpoint: https://s3.amazonaws.com
    region: us-east-1
    bucket: persona-pos-assets
    accessKeyId: AKIAIOSFODNN7EXAMPLE
    secretAccessKey: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Environment variables**:
```bash
VITE_STORAGE_ADAPTER=s3
VITE_STORAGE_S3_ENDPOINT=https://s3.amazonaws.com
VITE_STORAGE_S3_REGION=us-east-1
VITE_STORAGE_S3_BUCKET=your-bucket-name
VITE_STORAGE_S3_ACCESS_KEY_ID=your-access-key
VITE_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-key
```

**MinIO Example** (self-hosted S3):
```bash
VITE_STORAGE_S3_ENDPOINT=https://minio.yourcompany.com
VITE_STORAGE_S3_REGION=us-east-1
VITE_STORAGE_S3_BUCKET=assets
```

**DigitalOcean Spaces**:
```bash
VITE_STORAGE_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
VITE_STORAGE_S3_REGION=nyc3
VITE_STORAGE_S3_BUCKET=your-space-name
```

### Azure Blob Storage

Microsoft Azure cloud storage.

```yaml
storage:
  adapter: azure
  config:
    accountName: yourstorageaccount
    accountKey: your-storage-account-key
    container: assets
```

**Environment variables**:
```bash
VITE_STORAGE_ADAPTER=azure
VITE_STORAGE_AZURE_ACCOUNT_NAME=yourstorageaccount
VITE_STORAGE_AZURE_ACCOUNT_KEY=your-key
VITE_STORAGE_AZURE_CONTAINER=assets
```

## Feature Flags

Control which features are enabled:

```yaml
features:
  reports: true      # Enable reports module
  email: false       # Enable email functionality
  sms: false         # Enable SMS functionality
  sso: false         # Enable SSO providers
  storage: true      # Enable file storage
```

**Environment variables**:
```bash
VITE_FEATURE_REPORTS=true
VITE_FEATURE_EMAIL=false
VITE_FEATURE_SMS=false
VITE_FEATURE_SSO=false
VITE_FEATURE_STORAGE=true
```

## Environment Variables

Complete reference:

### Database
```bash
VITE_DB_ADAPTER=indexeddb|sqlite|postgres
VITE_DB_HOST=localhost
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=postgres
VITE_DB_PASSWORD=password
VITE_DB_FILENAME=./data/db.sqlite  # SQLite only
```

### Authentication
```bash
VITE_AUTH_ADAPTER=local|google|oidc
VITE_AUTH_SESSION_DURATION=86400000
VITE_AUTH_ISSUER=https://your-issuer.com
VITE_AUTH_CLIENT_ID=your-client-id
VITE_AUTH_CLIENT_SECRET=your-secret
VITE_AUTH_REDIRECT_URI=https://yourapp.com/callback
```

### Email
```bash
VITE_EMAIL_ADAPTER=console|smtp|resend
VITE_EMAIL_FROM=noreply@example.com
VITE_EMAIL_HOST=smtp.gmail.com
VITE_EMAIL_PORT=587
VITE_EMAIL_SECURE=false
VITE_EMAIL_USER=user@example.com
VITE_EMAIL_PASSWORD=password
VITE_EMAIL_RESEND_API_KEY=re_key
```

### SMS
```bash
VITE_SMS_ADAPTER=console|twilio
VITE_SMS_FROM=+1234567890
VITE_SMS_TWILIO_ACCOUNT_SID=AC...
VITE_SMS_TWILIO_AUTH_TOKEN=token
```

### Storage
```bash
VITE_STORAGE_ADAPTER=localstorage|s3|azure
VITE_STORAGE_S3_ENDPOINT=https://s3.amazonaws.com
VITE_STORAGE_S3_REGION=us-east-1
VITE_STORAGE_S3_BUCKET=bucket-name
VITE_STORAGE_S3_ACCESS_KEY_ID=key
VITE_STORAGE_S3_SECRET_ACCESS_KEY=secret
VITE_STORAGE_AZURE_ACCOUNT_NAME=account
VITE_STORAGE_AZURE_ACCOUNT_KEY=key
VITE_STORAGE_AZURE_CONTAINER=container
```

### Features
```bash
VITE_FEATURE_REPORTS=true
VITE_FEATURE_EMAIL=false
VITE_FEATURE_SMS=false
VITE_FEATURE_SSO=false
VITE_FEATURE_STORAGE=true
```

### Application
```bash
VITE_APP_NAME=Persona POS
VITE_APP_ENV=development|production
```

## Examples

### Example 1: Development (Default)

**`.env.local`:**
```bash
# Uses all defaults - IndexedDB, Local Auth, Console logging
VITE_APP_ENV=development
```

### Example 2: Small Business (SQLite + SMTP)

**`.env.local`:**
```bash
VITE_DB_ADAPTER=sqlite
VITE_DB_FILENAME=./data/store.db

VITE_EMAIL_ADAPTER=smtp
VITE_EMAIL_FROM=receipts@mystore.com
VITE_EMAIL_HOST=smtp.gmail.com
VITE_EMAIL_PORT=587
VITE_EMAIL_USER=receipts@mystore.com
VITE_EMAIL_PASSWORD=your-app-password

VITE_FEATURE_EMAIL=true
```

### Example 3: Enterprise (Postgres + Azure AD + S3)

**`.env.local`:**
```bash
# Database
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=postgres.company.com
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos_prod
VITE_DB_USER=pos_app
VITE_DB_PASSWORD=secure_password_here

# Authentication
VITE_AUTH_ADAPTER=oidc
VITE_AUTH_ISSUER=https://login.microsoftonline.com/YOUR_TENANT/v2.0
VITE_AUTH_CLIENT_ID=azure-client-id
VITE_AUTH_CLIENT_SECRET=azure-secret
VITE_AUTH_REDIRECT_URI=https://pos.company.com/auth/callback

# Email
VITE_EMAIL_ADAPTER=smtp
VITE_EMAIL_FROM=noreply@company.com
VITE_EMAIL_HOST=smtp.office365.com
VITE_EMAIL_PORT=587
VITE_EMAIL_USER=noreply@company.com
VITE_EMAIL_PASSWORD=email_password

# Storage
VITE_STORAGE_ADAPTER=s3
VITE_STORAGE_S3_ENDPOINT=https://s3.amazonaws.com
VITE_STORAGE_S3_REGION=us-west-2
VITE_STORAGE_S3_BUCKET=company-pos-assets
VITE_STORAGE_S3_ACCESS_KEY_ID=AKIA...
VITE_STORAGE_S3_SECRET_ACCESS_KEY=secret...

# Features
VITE_FEATURE_REPORTS=true
VITE_FEATURE_EMAIL=true
VITE_FEATURE_SMS=true
VITE_FEATURE_SSO=true
VITE_FEATURE_STORAGE=true

VITE_APP_ENV=production
```

### Example 4: Docker Compose (Postgres + MinIO)

**`docker-compose.yml`** automatically sets environment variables.

**`.env.local`:**
```bash
VITE_DB_ADAPTER=postgres
VITE_DB_HOST=postgres
VITE_DB_PORT=5432
VITE_DB_NAME=persona_pos
VITE_DB_USER=postgres
VITE_DB_PASSWORD=postgres

VITE_STORAGE_ADAPTER=s3
VITE_STORAGE_S3_ENDPOINT=http://minio:9000
VITE_STORAGE_S3_REGION=us-east-1
VITE_STORAGE_S3_BUCKET=assets
VITE_STORAGE_S3_ACCESS_KEY_ID=minioadmin
VITE_STORAGE_S3_SECRET_ACCESS_KEY=minioadmin
```

## Hot Reloading Configuration

Changes made via the Admin Settings UI (`/admin/settings`) take effect immediately without restarting the app. The DI container reloads automatically after saving.

## Security Best Practices

- **Never commit `.env.local`** or `config/local.yml` - they're gitignored
- **Use strong passwords** for database and auth
- **Rotate secrets** regularly
- **Use environment variables** for production secrets
- **Enable HTTPS** in production
- **Restrict database access** to app servers only
- **Use read-only credentials** where possible

## Troubleshooting

**Config not loading?**
- Check file syntax (YAML indentation)
- Verify environment variable names (must start with `VITE_`)
- Restart dev server after `.env.local` changes

**Adapter failing?**
- Test connection via Admin Settings UI
- Check logs in browser console
- Verify credentials are correct
- Ensure backend services are running (for non-browser adapters)

**Need help?**
- Check [CONTRIBUTING.md](CONTRIBUTING.md)
- Open an [issue](https://github.com/yourorg/persona-pos/issues)
- Join [Discord community](https://discord.gg/persona-pos)

---

For more information, see [README.md](README.md) and [SECURITY.md](SECURITY.md).
