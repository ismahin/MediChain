import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { ok } from "../utils/api.js";
import { ApiError } from "../utils/api.js";

const router = Router();
router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => ok(res, await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } }))));

router.put("/read-all", asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, isRead: false }, data: { isRead: true } });
  ok(res, null, "All notifications read");
}));

router.put("/:id/read", asyncHandler(async (req, res) => {
  const notification = await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
  if (!notification) throw new ApiError(404, "Notification not found");
  ok(res, await prisma.notification.update({ where: { id: notification.id }, data: { isRead: true } }), "Notification read");
}));

export default router;
