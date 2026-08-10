# Component Management Feature

## Overview

The Component Management feature allows administrators to view, check for updates, and update npm packages (dependencies) for both frontend and backend without needing terminal access.

## Access

Navigate to: **Admin Portal → Components** (`/admin/components`)

**Requirements:**
- Must be logged in as an admin user
- Admin role required

## Features

### 1. View All Components
- Lists all npm packages from both frontend and backend
- Shows current version, type (frontend/backend), and category (dependency/devDependency)
- Search functionality to find specific packages
- Filter by type (All, Frontend, Backend)

### 2. Check for Updates
- Click "Check for Updates" to scan npm registry
- Shows which packages have newer versions available
- Displays current version vs. latest version
- Limited to 50 packages per check to avoid timeout

### 3. Update Packages
- **Select Individual Packages**: Check boxes to select specific packages
- **Update Selected**: Update only the selected packages
- **Update All**: Update all packages in frontend or backend at once
- Confirmation dialog before updating

### 4. Filtering and Search
- Filter by component type (Frontend/Backend)
- Search by package name
- View only packages with available updates

## API Endpoints

### `GET /api/admin/components`
Returns list of all components with current versions.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "vite",
      "currentVersion": "^5.0.0",
      "type": "frontend",
      "category": "devDependency"
    }
  ]
}
```

### `GET /api/admin/components/updates`
Checks npm registry for available updates.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "name": "vite",
      "currentVersion": "5.0.0",
      "latestVersion": "5.1.0",
      "type": "frontend",
      "category": "devDependency"
    }
  ]
}
```

### `POST /api/admin/components/update`
Updates selected packages.

**Request:**
```json
{
  "packages": ["vite", "react"],
  "type": "frontend"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully updated 2 package(s)",
  "data": {
    "packages": ["vite", "react"],
    "type": "frontend",
    "output": "...",
    "errors": null
  }
}
```

### `POST /api/admin/components/update-all`
Updates all packages in frontend or backend.

**Request:**
```json
{
  "type": "frontend"
}
```

## Important Notes

### Container Rebuild Required
After updating packages, you **must** rebuild the Docker containers for changes to take effect:

```bash
# For development
docker-compose -f docker-compose.yml -f environments/dev/docker-compose.dev.yml build
docker-compose -f docker-compose.yml -f environments/dev/docker-compose.dev.yml up -d

# For production
docker-compose -f docker-compose.yml -f environments/prod/docker-compose.prod.yml build
docker-compose -f docker-compose.yml -f environments/prod/docker-compose.prod.yml up -d
```

### Security
- Only admin users can access this feature
- All operations are logged
- Updates are executed in the container's working directory
- Timeout limits prevent hanging operations (5 min for individual, 10 min for all)

### Limitations
- Update check is limited to 50 packages to avoid timeout
- Network access required to check npm registry
- Package updates modify `package.json` and `package-lock.json` files
- Container must have npm/node installed

## Usage Workflow

1. **View Components**: Navigate to Components page to see all packages
2. **Check Updates**: Click "Check for Updates" to see what's available
3. **Select Packages**: Check boxes next to packages you want to update
4. **Update**: Click "Update Selected" or use "Update All" buttons
5. **Confirm**: Review the confirmation dialog and confirm
6. **Rebuild**: After update completes, rebuild containers to apply changes

## Troubleshooting

### Updates Not Showing
- Check network connectivity (npm registry access required)
- Some packages may not be published to npm registry
- Private packages won't show updates

### Update Fails
- Check container logs: `docker-compose logs backend`
- Verify npm is installed in container
- Check file permissions in container
- Ensure sufficient disk space

### Changes Not Applied
- **Must rebuild containers** after updating packages
- Restart containers after rebuild
- Check that package.json was updated correctly

## Best Practices

1. **Test Updates**: Update in development environment first
2. **Backup**: Consider backing up package.json files before major updates
3. **Review Changes**: Check what changed in package-lock.json
4. **Incremental Updates**: Update packages in small batches rather than all at once
5. **Monitor Logs**: Watch container logs during updates
6. **Version Control**: Commit updated package.json files to version control

## Future Enhancements

Potential improvements:
- Update history/audit log
- Rollback functionality
- Dependency conflict detection
- Automated security vulnerability scanning
- Scheduled update checks
- Update notifications

