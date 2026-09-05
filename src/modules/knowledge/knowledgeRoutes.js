import { Router } from 'express';
import { authenticate, optionalAuth } from '../../middlewares/auth.js';
import { listKnowledge, uploadKnowledge, deleteKnowledge } from './knowledgeController.js';
import path from 'path';

const router = Router();

let uploadMiddleware = (req, res, next) => next();

try {
  const multerModule = await import('multer');
  const multer = multerModule.default || multerModule;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'text/csv',
      ];
      const allowedExts = ['.pdf', '.docx', '.txt', '.csv'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only PDF, DOCX, TXT, CSV are allowed.'));
      }
    },
  });
  uploadMiddleware = upload.single('file');
} catch {
  // Gracefully bypass if multer package is missing in local node_modules
  uploadMiddleware = (req, res, next) => next();
}

router.get('/', authenticate, listKnowledge);
router.post('/', authenticate, uploadMiddleware, uploadKnowledge);
router.delete('/:id', authenticate, deleteKnowledge);

export default router;

