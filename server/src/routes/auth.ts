import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authenticate, signAccessToken, signRefreshToken } from "../middleware/auth.js";
import { ApiError, ok, toPublicUser } from "../utils/api.js";

const router = Router();

const baseAuth = {
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().optional(),
  walletAddress: z.string().optional()
};

const patientSchema = z.object({
  ...baseAuth,
  fullName: z.string().min(2),
  confirmPassword: z.string().min(8),
  dateOfBirth: z.string(),
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

async function nextHealthId() {
  const count = await prisma.patientProfile.count();
  return `MCH-2026-${String(count + 1).padStart(6, "0")}`;
}

router.post(
  "/register/patient",
  asyncHandler(async (req, res) => {
    const body = patientSchema.parse(req.body);
    ensurePasswords(body.password, body.confirmPassword);
    const passwordHash = await bcrypt.hash(body.password, 12);
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
            healthId: await nextHealthId(),
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
    const passwordHash = await bcrypt.hash(body.password, 12);
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
    const passwordHash = await bcrypt.hash(body.password, 12);
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
    const passwordHash = await bcrypt.hash(body.password, 12);
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
    const body = z.object({ email: z.string().email(), password: z.string(), role: z.nativeEnum(Role).optional() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new ApiError(401, "Invalid email or password");
    }
    if (body.role && body.role !== user.role) throw new ApiError(403, "Selected role does not match this account");
    if (!user.isActive) throw new ApiError(403, "Account is suspended");
    ok(res, { user: toPublicUser(user), accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) }, "Logged in");
  })
);

router.post("/logout", authenticate, (_req, res) => ok(res, null, "Logged out"));

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
