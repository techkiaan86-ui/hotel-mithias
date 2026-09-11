import { Router } from 'express';
import {
  getThreads,
  handleAction,
  verifyWebhook,
  handleWebhook,
  sendTestMessage,
  handleEmbeddedSignupExchange,
  handleOAuthCallback,
} from './whatsappController.js';

const router = Router();

router.get('/threads', getThreads);
router.post('/action', handleAction);
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);
router.post('/send', sendTestMessage);
router.post('/embedded-signup', handleEmbeddedSignupExchange);
router.get('/oauth/callback', handleOAuthCallback);

export default router;


