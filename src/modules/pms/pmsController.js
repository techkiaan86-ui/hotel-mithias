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
