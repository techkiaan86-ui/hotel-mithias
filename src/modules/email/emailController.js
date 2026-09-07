import { emailService } from './emailService.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/**
 * Controller to test live IMAP / SMTP socket connection and greeting
 * Endpoint: POST /api/email/test-connection
 */
export const testConnectionController = async (req, res) => {
  try {
    const { email, password, host, port, method } = req.body;
    const result = await emailService.testMailboxConnection({ email, password, host, port, method });
    return successResponse(res, result, 'Mail server handshake successful');
  } catch (error) {
    return errorResponse(res, error.message, 400);
  }
};

/**
 * Controller to process inbound guest email (Webhook / API)
 * Endpoint: POST /api/email/inbound
 */
export const inboundEmailController = async (req, res) => {
  try {
    const hotelId = req.headers['x-hotel-id'] || req.query.hotelId || req.body?.hotelId || req.user?.hotelId || 'hotel-mercier';
    const result = await emailService.processInboundEmail({ ...req.body, hotelId });
    return successResponse(res, result, 'Inbound email processed and attached to conversation');
  } catch (error) {
    console.error('[Inbound Email Error]', error.message);
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Controller to dispatch outbound email to guest
 * Endpoint: POST /api/email/send
 */
export const sendEmailController = async (req, res) => {
  try {
    const hotelId = req.user?.hotelId || req.body?.hotelId || 'hotel-mercier';
    const { conversationId, toEmail, subject, text, author } = req.body;
    const result = await emailService.sendGuestEmail({
      hotelId,
      conversationId,
      toEmail,
      subject,
      text,
      author,
    });
    return successResponse(res, result, 'Email dispatched successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
