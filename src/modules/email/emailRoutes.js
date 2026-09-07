import { Router } from 'express';
import { testConnectionController, inboundEmailController, sendEmailController } from './emailController.js';

const router = Router();

// Test mail server connection (IMAP / SMTP socket handshake)
router.post('/test-connection', testConnectionController);

// Inbound email receiver (Webhook from email gateway / Brevo / IMAP fetcher)
router.post('/inbound', inboundEmailController);

// Outbound email dispatcher
router.post('/send', sendEmailController);

export default router;
