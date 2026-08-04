import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.js";
import patientRoutes from "./routes/patients.js";
import doctorRoutes from "./routes/doctors.js";
import hospitalRoutes from "./routes/hospitals.js";
import laboratoryRoutes from "./routes/laboratories.js";
import accessRoutes from "./routes/access.js";
import blockchainRoutes from "./routes/blockchain.js";
import adminRoutes from "./routes/admin.js";
import notificationRoutes from "./routes/notifications.js";
import careRoutes from "./routes/care.js";
import configRoutes from "./routes/config.js";
import { errorHandler, notFound } from "./middleware/error.js";

export const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (_req, res) => res.json({ success: true, message: "MediChain API is healthy" }));
app.use("/api/config", configRoutes);

app.use("/api/auth/login", rateLimit({ windowMs: env.LOGIN_RATE_WINDOW_MS, max: env.LOGIN_RATE_MAX, standardHeaders: true, legacyHeaders: false }) as any);
app.use("/api/auth", authRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/laboratories", laboratoryRoutes);
app.use("/api/access", accessRoutes);
app.use("/api/blockchain", blockchainRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/care", careRoutes);

app.use(notFound);
app.use(errorHandler);
