import { Router } from 'express';
import { connectPmsController, getPmsStatusController, syncPmsController } from './pmsController.js';
import { authenticate } from '../../middlewares/auth.js';

const router = Router();

/**
 * Strict authentication middleware helper:
 * Validates JWT Bearer token on all requests.
 * Allows demo fallback ONLY if DEMO_MODE === 'true' is explicitly configured in environment.
 */
const resolveHotelContext = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }
  if (process.env.DEMO_MODE === 'true') {
    req.user = { id: 'u-jonas', hotelId: 'hotel-mercier', role: 'MANAGER' };
    return next();
  }
  return res.status(401).json({ success: false, message: 'Authentication required. Missing or invalid Bearer token.', data: null });
};

router.post('/connect', resolveHotelContext, connectPmsController);
router.get('/status', resolveHotelContext, getPmsStatusController);
router.post('/sync', resolveHotelContext, syncPmsController);

export default router;
