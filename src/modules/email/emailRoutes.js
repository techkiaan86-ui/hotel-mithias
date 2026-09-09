import { Router } from 'express';
import {
  initiateGoogleOAuthController,
  googleOAuthCallbackController,
  testConnectionController,
  inboundEmailController,
  sendEmailController,
  syncGmailController,
} from './emailController.js';

const router = Router();

// Google OAuth 2.0 Initiation & Callback Routes
router.get('/oauth/google', initiateGoogleOAuthController);
router.get('/oauth/google/callback', googleOAuthCallbackController);

// Gmail Inbox Synchronization
router.post('/sync', syncGmailController);

// Test mail server connection (IMAP / SMTP socket handshake)
router.post('/test-connection', testConnectionController);

// Inbound email receiver (Webhook from email gateway / IMAP fetcher)
router.post('/inbound', inboundEmailController);

// Outbound email dispatcher
router.post('/send', sendEmailController);

export default router;
