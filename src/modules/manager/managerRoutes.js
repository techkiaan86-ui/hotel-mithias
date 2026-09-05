import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.js';
import {
  getBriefing,
  getActivityFeed,
  getAiRules,
  updateAiRules,
  getKnowledgeDocs,
} from './managerController.js';

const router = Router();

// Middleware that attaches user context if token exists, but doesn't block unauthenticated dev queries on GET
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticate(req, res, next);
  }
  next();
};

router.get('/briefing', optionalAuth, getBriefing);
router.get('/activity', optionalAuth, getActivityFeed);
router.get('/rules', optionalAuth, getAiRules);
router.put('/rules', authenticate, updateAiRules);
router.get('/knowledge', optionalAuth, getKnowledgeDocs);

export default router;
