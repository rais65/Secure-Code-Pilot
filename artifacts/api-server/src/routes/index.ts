import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reviewRouter from "./review";

const router: IRouter = Router();

router.use(healthRouter);

// Primary routes: /api/review/analyze, /api/review/autofix, etc.
router.use("/review", reviewRouter);

// Short aliases — any frontend calling /api/analyze, /api/autofix, or /api/fix
// is routed to the same handlers without a redirect.
for (const path of ["/analyze", "/autofix", "/fix"]) {
  router.use(path, (req, res, next) => {
    // /api/fix → same as /api/review/autofix
    req.url = path === "/fix" ? "/autofix" : path;
    reviewRouter(req, res, next);
  });
}

export default router;
