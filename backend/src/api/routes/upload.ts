import { Router, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import logger from '../../utils/logger';
import { Client } from 'minio';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  },
});

// MinIO client configuration
const getMinioClient = () => {
  const endPoint = process.env.MINIO_ENDPOINT || 'minio';
  const port = parseInt(process.env.MINIO_PORT || '9000');
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const accessKey = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'minioadmin';
  const secretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || 'CHANGE_THIS_PASSWORD';

  return new Client({
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey,
  });
};

const BUCKET_NAME = process.env.MINIO_BUCKET || 'stewardpos';

// Ensure bucket exists
const ensureBucket = async (minioClient: Client) => {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      logger.info(`Created MinIO bucket: ${BUCKET_NAME}`);
      
      // Set public read policy for the bucket
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`],
          },
        ],
      };
      await minioClient.setBucketPolicy(BUCKET_NAME, JSON.stringify(policy));
      logger.info(`Set public read policy for bucket: ${BUCKET_NAME}`);
    }
  } catch (error) {
    logger.error('Error ensuring bucket exists:', error);
    throw error;
  }
};

/**
 * POST /api/upload/logo
 * Upload a logo or icon image
 */
router.post('/logo', authenticate, upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const minioClient = getMinioClient();
    await ensureBucket(minioClient);

    // Generate unique filename
    const ext = path.extname(req.file.originalname) || '.png';
    const filename = `logos/${uuidv4()}${ext}`;

    // Upload to MinIO
    await minioClient.putObject(
      BUCKET_NAME,
      filename,
      req.file.buffer,
      req.file.size,
      {
        'Content-Type': req.file.mimetype,
      }
    );

    // Generate public URL
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const publicHost = process.env.MINIO_PUBLIC_HOST || `localhost:9000`;
    const fileUrl = `${protocol}://${publicHost}/${BUCKET_NAME}/${filename}`;

    logger.info(`Uploaded logo: ${filename}`);

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error: any) {
    logger.error('Upload error:', error);
    next(error);
  }
});

/**
 * POST /api/upload/icon
 * Upload a favicon/icon image
 */
router.post('/icon', authenticate, upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const minioClient = getMinioClient();
    await ensureBucket(minioClient);

    // Generate unique filename
    const ext = path.extname(req.file.originalname) || '.ico';
    const filename = `icons/${uuidv4()}${ext}`;

    // Upload to MinIO
    await minioClient.putObject(
      BUCKET_NAME,
      filename,
      req.file.buffer,
      req.file.size,
      {
        'Content-Type': req.file.mimetype,
      }
    );

    // Generate public URL
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const publicHost = process.env.MINIO_PUBLIC_HOST || `localhost:9000`;
    const fileUrl = `${protocol}://${publicHost}/${BUCKET_NAME}/${filename}`;

    logger.info(`Uploaded icon: ${filename}`);

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename,
        size: req.file.size,
        mimetype: req.file.mimetype,
      },
    });
  } catch (error: any) {
    logger.error('Upload error:', error);
    next(error);
  }
});

/**
 * DELETE /api/upload/:filename
 * Delete an uploaded file
 */
router.delete('/:filename', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const minioClient = getMinioClient();

    await minioClient.removeObject(BUCKET_NAME, decodeURIComponent(filename));
    
    logger.info(`Deleted file: ${filename}`);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error: any) {
    logger.error('Delete error:', error);
    next(error);
  }
});

export default router;

