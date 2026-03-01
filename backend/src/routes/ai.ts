import { Router } from 'express';
import { deepAnalyzeHandler, quickCheckHandler } from '../controllers/ai_controllers';

const router = Router();

router.post('/deep-analyze', deepAnalyzeHandler);
router.post('/quick-check', quickCheckHandler);

export default router;