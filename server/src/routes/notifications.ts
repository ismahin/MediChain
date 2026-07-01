import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ok } from "../utils/api.js";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => ok(res, await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } }))));

router.put("/read-all", asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  ok(res, null, "All notifications read");
}));

router.put("/:id/read", asyncHandler(async (req, res) => ok(res, await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } }), "Notification read")));

export default router;
