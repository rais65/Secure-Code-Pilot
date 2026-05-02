import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reviewRouter from "./review";

const router: IRouter = Router();

router.use(healthRouter);

// Primary route: /api/review/...
router.use("/review", reviewRouter);

// Short alias: /api/analyze and /api/autofix resolve to the same handlers
// This covers any frontend builds that call the shorter URL
router.use("/analyze", (req, res, next) => {
  req.url = "/analyze";
  reviewRouter(req, res, next);
});
router.use("/autofix", (req, res, next) => {
  req.url = "/autofix";
  reviewRouter(req, res, next);
});

export default router;
