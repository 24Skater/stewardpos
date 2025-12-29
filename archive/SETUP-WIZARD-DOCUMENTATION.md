# Production Setup Wizard - Documentation

## Overview

The stewardPOS application now includes a comprehensive production-ready setup wizard that guides users through initial configuration on first deployment.

## Features

### ✅ Complete Setup Flow

1. **Setup Detection** - Automatically detects if setup is needed
2. **Multi-Step Wizard** - 6-step guided configuration
3. **Database Configuration** - Support for PostgreSQL and SQLite
4. **Admin Account Creation** - Root user setup during installation
5. **Authentication Configuration** - Multiple auth method support
6. **Environment Configuration** - Dev/Staging/Production modes
7. **Demo Mode** - Quick setup with sample data
8. **Data Replication** - Multi-environment setup support

---

## Setup Wizard Steps

### Step 1: Welcome & Mode Selection
- **Production Setup**: Full configuration with your own database
- **Demo Mode**: Quick setup with existing database and sample data

### Step 2: Database Configuration (Production Only)
- **PostgreSQL**: 
  - Host, Port, Database Name
  - Username, Password
  - Connection testing
- **SQLite**: 
  - Database file path
  - Auto-created if doesn't exist

### Step 3: Admin Account Creation
- Full Name
- Email Address
- Password (min 8 characters)
- Password Confirmation

### Step 4: Authentication Methods
- **Local Authentication** (Email/Password) - Always available
- **Google OAuth** - Optional, requires Client ID/Secret
- **OIDC/SAML** - Enterprise SSO support

### Step 5: Environment & Advanced
- **Environment Selection**: Development, Staging, or Production
- **Data Replication**: Configure replication between environments
  - Source/Target environment selection
  - Dev → QA → Prod workflow support

### Step 6: Review & Complete
- Review all configuration
- Complete setup
- Automatic redirect to login

---

## API Endpoints

### `GET /api/setup/status`
Check if setup is needed.

**Response:**
```json
{
  "success": true,
  "data": {
    "isInitialized": false,
    "hasAdminUser": false,
    "needsSetup": true,
    "databaseAdapter": "postgres"
  }
}
```

### `POST /api/setup/test-database`
Test database connection before setup.

**Request:**
```json
{
  "adapter": "postgres",
  "host": "localhost",
  "port": 5432,
  "name": "stewardpos",
  "user": "postgres",
  "password": "password"
}
```

### `POST /api/setup/complete`
Complete the setup process.

**Request:**
```json
{
  "adminUser": {
    "name": "Admin User",
    "email": "admin@company.com",
    "password": "SecurePassword123"
  },
  "database": {
    "adapter": "postgres",
    "host": "localhost",
    "port": 5432,
    "name": "stewardpos",
    "user": "postgres",
    "password": "password"
  },
  "auth": {
    "methods": ["local", "google"],
    "google": {
      "clientId": "optional",
      "clientSecret": "optional"
    }
  },
  "environment": "production",
  "demoMode": false,
  "replication": {
    "enabled": true,
    "source": "dev",
    "target": "prod"
  }
}
```

---

## How It Works

### Automatic Detection

1. On app load, `SetupGuard` component checks `/api/setup/status`
2. If `needsSetup: true`, redirects to `/setup`
3. If setup complete, allows normal app access

### Setup Process

1. **Database Connection Test** - Validates database connectivity
2. **Migrations** - Runs database migrations automatically
3. **Admin User Creation** - Creates root administrator account
4. **Demo Data** - Optionally seeds sample data (if demo mode)
5. **Configuration Save** - Stores configuration (handled by deployment)

### After Setup

- User is redirected to login page
- Can login with created admin account
- Full access to admin panel and settings
- Can configure additional authentication methods from admin panel

---

## Database Options

### Option 1: External Database Server
- Point to existing PostgreSQL server
- Provide connection credentials
- System will test connection before proceeding

### Option 2: Local Database (Same Server)
- Use PostgreSQL container in Docker Compose
- Or use SQLite for simple deployments
- System handles database initialization

### Option 3: Demo Mode
- Uses existing database configuration from environment
- Skips database configuration step
- Loads sample data automatically

---

## Authentication Methods

### Local Authentication
- Email/Password based
- Always enabled
- Uses bcrypt for password hashing
- JWT tokens for sessions

### Google OAuth
- Requires Google Cloud Console setup
- Client ID and Secret configuration
- OAuth 2.0 flow

### OIDC/SAML
- Enterprise SSO support
- Configurable issuer URL
- Client ID/Secret for OIDC
- SAML metadata support (future)

---

## Environment Configuration

### Development
- Verbose logging
- Relaxed security (for local dev)
- Debug mode enabled

### Staging/QA
- Production-like settings
- Moderate logging
- Security enabled

### Production
- Minimal logging
- Maximum security
- Performance optimized
- Error tracking enabled

---

## Data Replication

### Multi-Environment Setup

The setup wizard supports configuring data replication between environments:

- **Dev → QA**: Sync development data to QA for testing
- **QA → Prod**: Promote tested data to production
- **Prod → Dev**: Sync production data back for development

### Replication Features

- Scheduled replication jobs
- Selective data sync
- Conflict resolution
- Audit logging

*Note: Replication implementation is configured during setup. Actual replication jobs are managed from the admin panel after setup.*

---

## Best Practices

### Production Deployment

1. **Use PostgreSQL** - Better for production workloads
2. **Strong Admin Password** - Minimum 16 characters recommended
3. **Environment Variables** - Store sensitive config in env vars
4. **SSL/TLS** - Enable for database connections in production
5. **Backup Strategy** - Configure database backups
6. **Monitoring** - Set up logging and monitoring

### Security

1. **Change Default Credentials** - Never use demo credentials in production
2. **Enable HTTPS** - Use SSL certificates
3. **Rate Limiting** - Already configured, adjust as needed
4. **CORS** - Configure allowed origins properly
5. **JWT Secret** - Use strong, random secret (min 32 characters)

### Database

1. **Connection Pooling** - Already configured
2. **Backup Strategy** - Regular automated backups
3. **Migration Strategy** - Test migrations in staging first
4. **Monitoring** - Monitor database performance

---

## Troubleshooting

### Setup Fails at Database Step

- Check database server is running
- Verify connection credentials
- Check network connectivity
- Ensure database exists (for PostgreSQL)
- Check firewall rules

### Setup Fails at Migration Step

- Check database permissions
- Ensure database is empty (or migrations are compatible)
- Check logs for specific error messages

### Admin User Creation Fails

- Check if user already exists
- Verify email format
- Check password requirements (min 8 chars)
- Review database logs

### Setup Page Doesn't Appear

- Check backend is running
- Verify `/api/setup/status` endpoint is accessible
- Check browser console for errors
- Clear browser cache

---

## Next Steps After Setup

1. **Login** - Use your admin account to login
2. **Configure Settings** - Go to Admin > Settings
3. **Add Users** - Create additional user accounts
4. **Configure Authentication** - Set up OAuth/OIDC if needed
5. **Import Data** - Import products, customers, etc.
6. **Configure Replication** - Set up data sync jobs (if multi-env)

---

## Files Created/Modified

### Backend
- `backend/src/api/routes/setup.ts` - Setup API endpoints
- `backend/src/server.ts` - Added setup routes

### Frontend
- `src/pages/Setup.tsx` - Setup wizard component
- `src/components/SetupGuard.tsx` - Setup detection guard
- `src/App.tsx` - Added setup route and guard

---

## Future Enhancements

- [ ] Configuration export/import
- [ ] Setup wizard resumable (save progress)
- [ ] Database migration preview
- [ ] Automated backup configuration
- [ ] SSL certificate setup
- [ ] Email/SMS provider configuration
- [ ] Storage provider configuration (S3, Azure)
- [ ] Multi-language support

---

## Support

For issues or questions:
1. Check logs: `docker-compose logs backend`
2. Review error messages in setup wizard
3. Verify environment variables
4. Check database connectivity

---

**Version:** 1.0.0  
**Last Updated:** 2025-12-22

