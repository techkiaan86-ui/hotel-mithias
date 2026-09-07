import { Router } from 'express';
import { realtimeService } from '../../services/realtimeService.js';

const router = Router();

/**
 * SSE Endpoint: GET /api/realtime/events
 * Connects browser clients to live event stream.
 */
router.get('/events', (req, res) => {
  const hotelId = req.query.hotelId || req.user?.hotelId || 'hotel-mercier';
  realtimeService.subscribe(hotelId, req, res);
});

/**
 * Diagnostic Endpoint: GET /api/realtime/stats
 */
router.get('/stats', (req, res) => {
  res.json({ success: true, stats: realtimeService.getStats() });
});

export default router;
