import { Router } from 'express';
import { login, getMe, getStaffList } from './authController.js';
import { authenticate } from '../../middlewares/auth.js';

const router = Router();

router.post('/login', login);
router.get('/me', authenticate, getMe);
router.get('/staff', getStaffList);

export default router;
