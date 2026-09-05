import { Router } from 'express';
import {
  getOnboardingStatus,
  getHotelProfile,
  saveHotelProfile,
  saveTopology,
  saveOnboardingStep,
  completeOnboarding,
} from './onboardingController.js';

const router = Router();

router.get('/status', getOnboardingStatus);
router.get('/profile', getHotelProfile);
router.post('/profile', saveHotelProfile);
router.post('/topology', saveTopology);
router.post('/step', saveOnboardingStep);
router.post('/complete', completeOnboarding);

export default router;
