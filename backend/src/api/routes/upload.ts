import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

const router = Router();

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
const logosDir = path.join(uploadsDir, 'logos');
const iconsDir = path.join(uploadsDir, 'icons');

// Attempt to create directories (may fail in Docker if permissions aren't set)
try {
  [uploadsDir, logosDir, iconsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
} catch (error) {
  logger.warn('Could not create upload directories - they may already exist or require different permissions', { error });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type;
    if (type === 'logo') {
      cb(null, logosDir);
    } else if (type === 'icon' || type === 'favicon') {
      cb(null, iconsDir);
    } else {
      cb(null, uploadsDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

const fileFilter = (_req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PNG, JPG, GIF, SVG, WebP, and ICO files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// All upload routes require authentication and admin/manager role
router.use(authenticate);
router.use(authorize(['admin', 'manager']));

/**
 * POST /api/upload/:type
 * Upload a file (logo, icon/favicon)
 */
router.post('/:type', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    // Construct the URL for the uploaded file (use relative URLs for nginx proxy compatibility)
    let fileUrl = '';
    
    if (type === 'logo') {
      fileUrl = `/uploads/logos/${req.file.filename}`;
    } else if (type === 'icon' || type === 'favicon') {
      fileUrl = `/uploads/icons/${req.file.filename}`;
    } else {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    logger.info(`File uploaded: ${type} - ${req.file.filename}`);

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename: req.file.filename,
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
router.delete('/:type/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { type, filename } = req.params;
    
    let filePath = '';
    if (type === 'logo') {
      filePath = path.join(logosDir, filename);
    } else if (type === 'icon' || type === 'favicon') {
      filePath = path.join(iconsDir, filename);
    } else {
      filePath = path.join(uploadsDir, filename);
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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
