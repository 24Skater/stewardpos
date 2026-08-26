import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  requirePermission,
  type PermissionAction,
  type PermissionResource,
} from '../middleware/authorize';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import logger from '../../utils/logger';
import { ValidationError } from '../../utils/errors';
import { storage as store } from '../../storage';
import { matchesDeclaredType } from './imageSignature';

const router = Router();

// Configure multer for file uploads
/**
 * The image types accepted, and the extension each is stored with.
 *
 * The extension is derived from here, **not** from the uploaded filename. Taking
 * it from `originalname` meant a caller could upload `payload.js` while claiming
 * `Content-Type: image/png`: the mimetype check passed, the file was written as
 * `<uuid>.js`, and `/uploads` served it as `application/javascript` from the
 * app's own origin. Under a `script-src 'self'` CSP that is executable — stored
 * XSS, needing only permission to change a logo.
 *
 * SVG is deliberately absent. It is a document format that can carry script, and
 * an SVG served from this origin is the same problem in a different costume. PNG,
 * JPEG, GIF, WebP, and ICO cover what a logo or favicon needs.
 */
const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

/**
 * Where each upload kind lands, and what it takes to write there.
 *
 * An unknown kind is refused rather than defaulted, so a typo cannot quietly
 * drop a file into someone else's directory.
 *
 * The permission is per kind. It used to be `settings.write` for everything,
 * which is right for a logo but wrong for a product photo: it would have meant
 * nobody could add one without also being able to change the store's payment
 * credentials, and the people who maintain the catalog are not the people who
 * administer the store.
 */
const DESTINATIONS: Record<string, { subdir: string; resource: PermissionResource }> = {
  logo: { subdir: 'logos', resource: 'settings' },
  icon: { subdir: 'icons', resource: 'settings' },
  favicon: { subdir: 'icons', resource: 'settings' },
  product: { subdir: 'products', resource: 'inventory' },
};

/**
 * Buffer the upload rather than streaming it to a path.
 *
 * `diskStorage` had multer choose the destination directory, which only makes
 * sense when the destination is a directory. With the storage port in front,
 * the route no longer knows whether the bytes will end up on a volume or in a
 * bucket, so it hands multer nowhere to put them and passes the buffer on. The
 * 5MB limit below is what makes that safe: it is enforced by multer as the
 * request is read, so a large upload is refused rather than accumulated.
 */
const storage = multer.memoryStorage();

const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ACCEPTED_IMAGE_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    // ValidationError, not a bare Error: multer passes whatever it is handed to
    // `next`, and an unclassified Error lands in the handler as a 500. "You sent
    // the wrong kind of file" is the caller's problem and reads as an outage in
    // logs otherwise.
    cb(new ValidationError('Only PNG, JPG, GIF, WebP, and ICO images are allowed'));
  }
};

/**
 * Turn multer's own failures into the envelope the rest of the API uses.
 *
 * Its size limit and field checks raise `MulterError`, which would otherwise
 * surface as a 500 for what is squarely a bad request.
 */
function handleUploadErrors(
  error: unknown,
  _req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  if (error instanceof multer.MulterError) {
    next(
      new ValidationError(
        error.code === 'LIMIT_FILE_SIZE' ? 'That file is larger than 5MB' : error.message
      )
    );
    return;
  }
  next(error);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

router.use(authenticate);

/**
 * Authorise against the kind of thing being uploaded.
 *
 * Checked before multer runs, so an unauthorised request never writes a file
 * that a later check would have to clean up.
 */
function authorizeForType(action: PermissionAction) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const destination = DESTINATIONS[req.params.type];
    if (!destination) {
      next(new ValidationError('Unknown upload type'));
      return;
    }
    requirePermission(destination.resource, action)(req, res, next);
  };
}

/**
 * POST /api/upload/:type
 * Upload a file (logo, icon/favicon)
 */
router.post('/:type', authorizeForType('write'), upload.single('file'), handleUploadErrors, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    /**
     * The bytes have to agree with the label.
     *
     * `fileFilter` above checked `file.mimetype`, which multer copies from the
     * caller's own part header - it is a claim, not a measurement. Everything
     * downstream trusts it: the stored extension is chosen from it, and the
     * `/uploads` route serves the file back with it as the `Content-Type`. So
     * this is where the claim gets tested against the thing it describes.
     *
     * Refused as a ValidationError, the same 400 an unsupported type gets: from
     * the caller's side both are "that is not a file I can accept", and telling
     * the two apart only helps someone probing for what slips through.
     */
    if (!matchesDeclaredType(req.file.buffer, req.file.mimetype)) {
      logger.warn(`Rejected ${type} upload: bytes are not a valid ${req.file.mimetype}`);
      throw new ValidationError('That file is not a valid image');
    }

    const { subdir } = DESTINATIONS[type];
    // A generated name plus an extension the server chose: nothing the caller
    // supplied reaches the store.
    const filename = `${randomUUID()}${ACCEPTED_IMAGE_TYPES[req.file.mimetype]}`;

    await store().put(subdir, filename, req.file.buffer, req.file.mimetype);

    // Relative URL, for reverse-proxy compatibility — and adapter-independent:
    // the same path resolves whether the bytes are on a volume or in a bucket,
    // so switching STORAGE_ADAPTER does not invalidate a URL already saved in
    // `settings.logo_url` or `products.image_url`. The subdirectory comes from
    // the same table the write used, rather than being re-derived here - the
    // previous `type === 'logo' ? ... : 'icons'` would have pointed a product
    // image at the icons directory the moment a third kind existed.
    const fileUrl = `/uploads/${subdir}/${filename}`;

    logger.info(`File uploaded: ${type} - ${filename}`);

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/upload/:type/:filename
 * Delete an uploaded file
 */
router.delete('/:type/:filename', authorizeForType('write'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, filename } = req.params;

    const { subdir } = DESTINATIONS[type];

    // Express decodes the route parameter, so `..%2F..%2F..%2Fetc%2Fpasswd`
    // arrives here as a traversal sequence that `path.join` happily resolves -
    // it deleted files anywhere the process could write, including the SQLite
    // database on a SQLite deployment. Only a bare filename is a filename.
    if (filename !== path.basename(filename) || filename === '..' || filename.includes('\0')) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    // The store enforces this again at its own boundary. Both checks stay: this
    // one so the caller gets "Invalid filename" rather than a generic validation
    // error, and that one so the guarantee does not rest on every future caller
    // of the port remembering to check first.
    if (await store().remove(subdir, filename)) {
      logger.info(`File deleted: ${type} - ${filename}`);
      
      res.json({
        success: true,
        message: 'File deleted successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
