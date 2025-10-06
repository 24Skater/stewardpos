import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // TODO: Implement
    res.json({ success: true, data: [] });
  } catch (error) {
    next(error);
  }
});

export default router;
