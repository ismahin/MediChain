import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Role, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authenticate, signAccessToken, signRefreshToken } from "../middleware/auth.js";
import { ApiError, ok, toPublicUser } from "../utils/api.js";
import { env } from "../config/env.js";
import { generateHealthId } from "../utils/healthId.js";

const router = Router();

const baseAuth = {
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  walletAddress: z.string().trim().refine((value) => value === "" || /^0x[0-9a-fA-F]{40}$/.test(value), "Wallet address must be a valid 0x address").transform((value) => value || undefined).optional()
};

const pastDateString = z.string().refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date < new Date();
}, "Date must be a valid date in the past");

const patientSchema = z.object({
  ...baseAuth,
  fullName: z.string().min(2),
  confirmPassword: z.string().min(8),
  dateOfBirth: pastDateString,
  gender: z.string(),
  nidOrBirthCertificate: z.string().min(4),
  bloodGroup: z.string(),
  emergencyContactName: z.string(),
  emergencyContactPhone: z.string(),
  address: z.string()
});

const providerSchema = z.object({
  ...baseAuth,
  fullName: z.string().min(2),
  confirmPassword: z.string().min(8),
  organizationName: z.string().optional(),
  specialization: z.string().optional(),
  medicalRegistrationNumber: z.string().optional(),
  licenseNumber: z.string().optional(),
  address: z.string().optional()
});

function ensurePasswords(password: string, confirmPassword: string) {
  if (password !== confirmPassword) throw new ApiError(400, "Passwords do not match");
}

router.post(
  "/register/patient",
  asyncHandler(async (req, res) => {
    const body = patientSchema.parse(req.body);
    ensurePasswords(body.password, body.confirmPassword);
    const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        passwordHash,
        phone: body.phone,
        role: Role.PATIENT,
        walletAddress: body.walletAddress,
        patientProfile: {
          create: {
            healthId: await generateHealthId(),
            nidOrBirthCertificate: body.nidOrBirthCertificate,
            dateOfBirth: new Date(body.dateOfBirth),
            gender: body.gender,
            bloodGroup: body.bloodGroup,
            allergies: [],
            chronicConditions: [],
            currentMedications: [],
            surgeryHistory: [],
            vaccinationHistory: [],
            emergencyContactName: body.emergencyContactName,
            emergencyContactPhone: body.emergencyContactPhone,
            address: body.address
          }
        }
      },
      include: { patientProfile: true }
    });
    ok(res.status(201), { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user), profile: user.patientProfile }, "Patient registered");
  })
);

router.post(
  "/register/doctor",
  asyncHandler(async (req, res) => {
    const body = providerSchema.extend({
      medicalRegistrationNumber: z.string().min(3),
      specialization: z.string().min(2),
      organizationName: z.string().min(2)
    }).parse(req.body);
    ensurePasswords(body.password, body.confirmPassword);
    const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        passwordHash,
        phone: body.phone,
        role: Role.DOCTOR,
        walletAddress: body.walletAddress,
        doctorProfile: {
          create: {
            medicalRegistrationNumber: body.medicalRegistrationNumber,
            specialization: body.specialization,
            organizationName: body.organizationName,
            verificationStatus: VerificationStatus.PENDING
          }
        }
      },
      include: { doctorProfile: true }
    });
    ok(res.status(201), { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user), profile: user.doctorProfile }, "Doctor registered pending verification");
  })
);

router.post(
  "/register/hospital",
  asyncHandler(async (req, res) => {
    const body = providerSchema.extend({ fullName: z.string().min(2), licenseNumber: z.string().min(3), address: z.string().min(5) }).parse(req.body);
    ensurePasswords(body.password, body.confirmPassword);
    const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        passwordHash,
        phone: body.phone,
        role: Role.HOSPITAL,
        walletAddress: body.walletAddress,
        hospitalProfile: { create: { hospitalName: body.fullName, licenseNumber: body.licenseNumber, address: body.address, verificationStatus: VerificationStatus.PENDING } }
      },
      include: { hospitalProfile: true }
    });
    ok(res.status(201), { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user), profile: user.hospitalProfile }, "Hospital registered pending verification");
  })
);

router.post(
  "/register/laboratory",
  asyncHandler(async (req, res) => {
    const body = providerSchema.extend({ fullName: z.string().min(2), licenseNumber: z.string().min(3), address: z.string().min(5) }).parse(req.body);
    ensurePasswords(body.password, body.confirmPassword);
    const passwordHash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        passwordHash,
        phone: body.phone,
        role: Role.LABORATORY,
        walletAddress: body.walletAddress,
        laboratoryProfile: { create: { laboratoryName: body.fullName, licenseNumber: body.licenseNumber, address: body.address, verificationStatus: VerificationStatus.PENDING } }
      },
      include: { laboratoryProfile: true }
    });
    ok(res.status(201), { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user), profile: user.laboratoryProfile }, "Laboratory registered pending verification");
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string(), role: z.nativeEnum(Role).optional() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (body.role && body.role !== user.role) throw new ApiError(403, "Selected role does not match this account");
    if (!user.isActive) throw new ApiError(403, "Account is suspended");
    ok(res, { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) }, "Logged in");
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
    let payload: { sub: string };
    try { payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { sub: string }; }
    catch { throw new ApiError(401, "Invalid or expired refresh token"); }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.isActive) throw new ApiError(401, "Invalid or inactive account");
    ok(res, { accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) }, "Session refreshed");
  })
);

router.post("/logout", authenticate, (_req, res) => ok(res, null, "Logged out"));

router.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8), confirmPassword: z.string().min(8) }).parse(req.body);
    ensurePasswords(body.newPassword, body.confirmPassword);
    if (body.currentPassword === body.newPassword) throw new ApiError(400, "New password must be different from the current password");
    if (!(await bcrypt.compare(body.currentPassword, req.user!.passwordHash))) throw new ApiError(400, "Current password is incorrect");
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash: await bcrypt.hash(body.newPassword, env.BCRYPT_ROUNDS) } });
    ok(res, null, "Password changed successfully");
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { patientProfile: true, doctorProfile: true, hospitalProfile: true, laboratoryProfile: true }
    });
    ok(res, { user: toPublicUser(user!), profile: user?.patientProfile ?? user?.doctorProfile ?? user?.hospitalProfile ?? user?.laboratoryProfile ?? null });
  })
);

export default router;
