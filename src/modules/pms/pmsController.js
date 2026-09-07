import { pmsService } from './pmsService.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/**
 * Controller handling PMS connect requests
 * Endpoint: POST /api/pms/connect
 */
export const connectPmsController = async (req, res) => {
  try {
    const { provider, propertyId } = req.body;

    // Tenant isolation: Resolve hotel ID from authenticated user, never from request body
    const hotelId = req.user?.hotelId || 'hotel-mercier';

    if (!propertyId || typeof propertyId !== 'string') {
      return errorResponse(res, 'Property ID is required', 400);
    }

    const result = await pmsService.connectPms(hotelId, { provider, propertyId });

    return successResponse(res, result, 'PMS connected successfully');
  } catch (error) {
    const statusCode = error.message.includes('required') || error.message.includes('not supported') ? 400 : 500;
    return errorResponse(res, error.message, statusCode);
  }
};

/**
 * Controller retrieving PMS connection status
 * Endpoint: GET /api/pms/status
 */
export const getPmsStatusController = async (req, res) => {
  try {
    const hotelId = req.user?.hotelId || 'hotel-mercier';
    const status = await pmsService.getPmsStatus(hotelId);
    return successResponse(res, status, 'PMS status retrieved successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Controller executing real PMS data synchronization
 * Endpoint: POST /api/pms/sync
 */
export const syncPmsController = async (req, res) => {
  try {
    const hotelId = req.user?.hotelId || 'hotel-mercier';
    const syncResult = await pmsService.syncPmsData(hotelId);
    return successResponse(res, syncResult, 'PMS data synchronized successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Controller querying live availability and starting rates
 * Endpoint: GET /api/pms/availability
 */
export const checkAvailabilityController = async (req, res) => {
  try {
    const hotelId = req.user?.hotelId || req.query.hotelId || 'hotel-mercier';
    const { checkIn, checkOut } = req.query;
    const availability = await pmsService.checkAvailability(hotelId, { checkIn, checkOut });
    return successResponse(res, availability, 'Availability fetched successfully');
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Controller receiving live Mews PMS Webhook events
 * Endpoint: POST /api/pms/webhook (and /api/pms/webhook/mews)
 */
export const mewsWebhookController = async (req, res) => {
  try {
    const headerHotelId = req.headers['x-mews-hotel-id'] || req.headers['x-hotel-id'];
    const hotelId = headerHotelId || req.query.hotelId || req.body?.hotelId || req.user?.hotelId || 'hotel-mercier';

    // Verify webhook signature or token if configured
    const webhookSecret = process.env.MEWS_WEBHOOK_SECRET;
    if (webhookSecret) {
      const incomingSecret = req.headers['x-mews-signature'] || req.headers['x-webhook-secret'] || req.query.secret;
      if (incomingSecret !== webhookSecret) {
        return errorResponse(res, 'Invalid webhook signature or secret', 401);
      }
    }

    const result = await pmsService.handleMewsWebhook(hotelId, req.body);
    return successResponse(res, result, 'Mews Webhook processed successfully');
  } catch (error) {
    console.error('[Mews Webhook Error]', error.message);
    return errorResponse(res, error.message, 500);
  }
};
