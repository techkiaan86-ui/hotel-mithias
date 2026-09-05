import { Router } from 'express';
import {
  getThreads,
  handleAction,
  verifyWebhook,
  handleWebhook,
  sendTestMessage,
} from './whatsappController.js';

const router = Router();

router.get('/threads', getThreads);
router.post('/action', handleAction);
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);
router.post('/send', sendTestMessage);

export default router;

