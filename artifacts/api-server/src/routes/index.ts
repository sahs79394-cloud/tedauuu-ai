import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import chatRouter from "./chat.js";
import whatsappRouter from "./whatsapp.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(whatsappRouter);

export default router;
