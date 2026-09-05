import { Router } from 'express';
import { getUpsells, updateUpsellStatus } from './upsellsController.js';

const router = Router();

router.get('/', getUpsells);
router.patch('/:id/status', updateUpsellStatus);

export default router;
