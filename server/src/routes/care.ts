import path from "path";
import fs from "fs";
import { Router } from "express";
import { CareCaseStatus, DiagnosticOrderStatus, RecordType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { authenticate, requireRoles } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { uploadTo, validateUploadedFile } from "../middleware/upload.js";
import { ApiError, ok, publicUserSelect, withoutStoragePath } from "../utils/api.js";
import { hashFile, hashMetadata } from "../utils/hash.js";
import { ACCESS_CATEGORIES, hasPatientAccess, isAllowedProviderAccessCategory, isSupportedAccessCategory, patientAccessStatus } from "../services/access.js";
import { env } from "../config/env.js";
import { writeAudit } from "../services/audit.js";

const router = Router();
const caseUpload = uploadTo("case-documents");
const reportUpload = uploadTo("reports");
router.use(authenticate);

const caseDocumentSelect = {
  id: true,
  careCaseId: true,
  originalFileName: true,
  mimeType: true,
  fileSize: true,
  fileHash: true,
  createdAt: true
} as const;

const patientIdentitySelect = {
  id: true,
  userId: true,
  healthId: true,
  user: { select: { id: true, fullName: true } }
} as const;

async function ownPatient(userId: string) {
  const patient = await prisma.patientProfile.findUnique({ where: { userId } });
  if (!patient) throw new ApiError(404, "Patient profile not found");
  return patient;
}

async function usersByIds(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: publicUserSelect });
  return new Map(users.map((user) => [user.id, user]));
}

async function reportsByIds(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  const reports = await prisma.medicalRecord.findMany({ where: { id: { in: unique }, recordType: RecordType.LAB_REPORT }, omit: { filePath: true }, include: { patient: { select: patientIdentitySelect }, creator: { select: publicUserSelect } } });
  return new Map(reports.map((report) => [report.id, report]));
}

async function hydrateCases(cases: any[]) {
  const [users, reports] = await Promise.all([
    usersByIds(cases.flatMap((item) => [item.hospitalUserId, item.preferredDoctorUserId, item.assignedDoctorUserId, ...item.diagnosticOrders.map((order: any) => order.laboratoryUserId)])),
    reportsByIds(cases.flatMap((item) => item.diagnosticOrders.map((order: any) => order.reportMedicalRecordId)))
  ]);
  return cases.map((item) => ({
    ...item,
    hospital: users.get(item.hospitalUserId),
    preferredDoctor: users.get(item.preferredDoctorUserId),
    assignedDoctor: users.get(item.assignedDoctorUserId),
    diagnosticOrders: item.diagnosticOrders.map((order: any) => ({ ...order, laboratory: users.get(order.laboratoryUserId), report: reports.get(order.reportMedicalRecordId) }))
  }));
}

router.get("/directory", requireRoles(Role.PATIENT), asyncHandler(async (_req, res) => {
  const [hospitals, doctors] = await Promise.all([
    prisma.user.findMany({ where: { role: Role.HOSPITAL, isActive: true, hospitalProfile: { verificationStatus: "VERIFIED" } }, select: { ...publicUserSelect, hospitalProfile: true } }),
    prisma.user.findMany({ where: { role: Role.DOCTOR, isActive: true, doctorProfile: { verificationStatus: "VERIFIED" } }, select: { ...publicUserSelect, doctorProfile: true } })
  ]);
  ok(res, { hospitals, doctors });
}));

router.post("/cases", requireRoles(Role.PATIENT), caseUpload.array("documents", 5) as any, asyncHandler(async (req, res) => {
  const patient = await ownPatient(req.user!.id);
  const body = z.object({ problemTitle: z.string().min(3), problemDetails: z.string().min(10), hospitalUserId: z.string(), preferredDoctorUserId: z.string().optional(), appointmentDate: z.string() }).parse(req.body);
  const hospital = await prisma.user.findFirst({ where: { id: body.hospitalUserId, role: Role.HOSPITAL, isActive: true, hospitalProfile: { verificationStatus: "VERIFIED" } } });
  if (!hospital) throw new ApiError(400, "Select a verified hospital");
  if (body.preferredDoctorUserId) {
    const doctor = await prisma.user.findFirst({ where: { id: body.preferredDoctorUserId, role: Role.DOCTOR, isActive: true, doctorProfile: { verificationStatus: "VERIFIED" } } });
    if (!doctor) throw new ApiError(400, "Selected preferred doctor is unavailable");
  }
  const appointmentDate = new Date(body.appointmentDate);
  if (Number.isNaN(appointmentDate.getTime()) || appointmentDate <= new Date()) throw new ApiError(400, "Choose a future appointment date and time");
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  files.forEach(validateUploadedFile);
  const documents = await Promise.all(files.map(async (file) => ({ filePath: path.resolve(file.path), originalFileName: file.originalname, mimeType: file.mimetype, fileSize: file.size, fileHash: await hashFile(file.path) })));
  const careCase = await prisma.$transaction(async (tx) => {
    const created = await tx.careCase.create({ data: { patientId: patient.id, problemTitle: body.problemTitle, problemDetails: body.problemDetails, hospitalUserId: hospital.id, preferredDoctorUserId: body.preferredDoctorUserId || null, appointmentDate, documents: { create: documents } }, include: { documents: { select: caseDocumentSelect }, diagnosticOrders: true } });
    await tx.notification.create({ data: { userId: hospital.id, title: "New appointment request", message: `${req.user!.fullName} submitted ${body.problemTitle}.`, relatedEntityType: "CareCase", relatedEntityId: created.id } });
    return created;
  });
  ok(res.status(201), careCase, "Appointment request submitted to the hospital");
}));

router.get("/cases/mine", requireRoles(Role.PATIENT), asyncHandler(async (req, res) => {
  const patient = await ownPatient(req.user!.id);
  const cases = await prisma.careCase.findMany({ where: { patientId: patient.id }, include: { documents: { select: caseDocumentSelect }, diagnosticOrders: true }, orderBy: { createdAt: "desc" } });
  ok(res, await hydrateCases(cases));
}));

router.get("/documents/:id/download", asyncHandler(async (req, res) => {
  const document = await prisma.caseDocument.findUnique({ where: { id: req.params.id }, include: { careCase: { include: { patient: true } } } });
  if (!document) throw new ApiError(404, "Case document not found");
  const allowed = req.user!.role === Role.ADMIN ||
    (req.user!.role === Role.PATIENT && document.careCase.patient.userId === req.user!.id) ||
    (req.user!.role === Role.HOSPITAL && document.careCase.hospitalUserId === req.user!.id) ||
    (req.user!.role === Role.DOCTOR && document.careCase.assignedDoctorUserId === req.user!.id && await hasPatientAccess(req.user!.id, document.careCase.patientId, ACCESS_CATEGORIES.FULL));
  if (!allowed) throw new ApiError(403, "You do not have permission to open this document");
  const root = path.resolve(process.cwd(), env.UPLOAD_DIR);
  const fullPath = path.resolve(document.filePath);
  const relativePath = path.relative(root, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(fullPath)) throw new ApiError(404, "Document file no longer exists");
  res.download(fullPath, document.originalFileName);
}));

router.get("/hospital/cases", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const cases = await prisma.careCase.findMany({ where: { hospitalUserId: req.user!.id }, include: { patient: { select: patientIdentitySelect }, documents: { select: caseDocumentSelect }, diagnosticOrders: true }, orderBy: { createdAt: "desc" } });
  ok(res, await hydrateCases(cases));
}));

router.get("/hospital/doctors", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const memberships = await prisma.hospitalDoctor.findMany({ where: { hospitalUserId: req.user!.id, status: "APPROVED" }, select: { doctorUserId: true } });
  ok(res, await prisma.user.findMany({ where: { id: { in: memberships.map((item) => item.doctorUserId) }, role: Role.DOCTOR, isActive: true, doctorProfile: { verificationStatus: "VERIFIED" } }, select: { ...publicUserSelect, doctorProfile: true }, orderBy: { fullName: "asc" } }));
}));

router.post("/hospital/cases/:id/assign-doctor", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const { doctorUserId, hospitalNotes } = z.object({ doctorUserId: z.string(), hospitalNotes: z.string().optional() }).parse(req.body);
  const careCase = await prisma.careCase.findFirst({ where: { id: req.params.id, hospitalUserId: req.user!.id } });
  if (!careCase) throw new ApiError(404, "Care case not found");
  if (careCase.status === CareCaseStatus.COMPLETED || careCase.status === CareCaseStatus.CANCELLED) throw new ApiError(409, "A closed care case cannot be reassigned");
  if (careCase.assignedDoctorUserId && careCase.status !== CareCaseStatus.DOCTOR_ASSIGNED) throw new ApiError(409, "The doctor cannot be changed after patient consent or clinical care has started");
  const doctor = await prisma.user.findFirst({ where: { id: doctorUserId, role: Role.DOCTOR, isActive: true, doctorProfile: { verificationStatus: "VERIFIED" } } });
  if (!doctor) throw new ApiError(400, "Select an available verified doctor");
  const membership = await prisma.hospitalDoctor.findUnique({ where: { hospitalUserId_doctorUserId: { hospitalUserId: req.user!.id, doctorUserId: doctor.id } } });
  if (!membership || membership.status !== "APPROVED") throw new ApiError(400, "This doctor must approve the hospital staff invitation before receiving patient cases");
  const updated = await prisma.careCase.update({ where: { id: careCase.id }, data: { assignedDoctorUserId: doctor.id, hospitalNotes, status: CareCaseStatus.DOCTOR_ASSIGNED } });
  await Promise.all([
    prisma.notification.create({ data: { userId: doctor.id, title: "Patient case assigned", message: `${careCase.problemTitle} was assigned to you. Request patient access before review.`, relatedEntityType: "CareCase", relatedEntityId: careCase.id } }),
    prisma.notification.create({ data: { userId: (await prisma.patientProfile.findUniqueOrThrow({ where: { id: careCase.patientId } })).userId, title: "Doctor assigned", message: `${doctor.fullName} was assigned to your appointment.`, relatedEntityType: "CareCase", relatedEntityId: careCase.id } })
  ]);
  ok(res, updated, "Doctor assigned to patient case");
}));

router.get("/doctor/cases", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const cases = await prisma.careCase.findMany({ where: { assignedDoctorUserId: req.user!.id }, include: { patient: { select: patientIdentitySelect }, documents: { select: caseDocumentSelect }, diagnosticOrders: true }, orderBy: { updatedAt: "desc" } });
  const hydrated = await hydrateCases(cases);
  ok(res, await Promise.all(hydrated.map(async (item: any) => ({ ...item, accessStatus: await patientAccessStatus(req.user!.id, item.patientId) }))));
}));

router.post("/doctor/cases/:id/request-access", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const careCase = await prisma.careCase.findFirst({ where: { id: req.params.id, assignedDoctorUserId: req.user!.id } });
  if (!careCase) throw new ApiError(404, "Assigned care case not found");
  const status = await patientAccessStatus(req.user!.id, careCase.patientId);
  if (status === "ACTIVE") throw new ApiError(409, "Patient access is already active");
  if (status === "PENDING") throw new ApiError(409, "Patient access request is already pending");
  const body = z.object({
    requestedCategories: z.array(z.string().refine((category) => isSupportedAccessCategory(category) && isAllowedProviderAccessCategory("DOCTOR", category), "Unsupported access category")).min(1),
    reason: z.string().min(5),
    requestedDurationHours: z.number().int().min(1).max(env.MAX_ACCESS_DURATION_HOURS)
  }).parse(req.body);
  const request = await prisma.accessRequest.create({ data: { patientId: careCase.patientId, requesterUserId: req.user!.id, requesterRole: Role.DOCTOR, ...body } });
  await prisma.careCase.update({ where: { id: careCase.id }, data: { status: CareCaseStatus.CONSENT_PENDING } });
  const patient = await prisma.patientProfile.findUniqueOrThrow({ where: { id: careCase.patientId } });
  await prisma.notification.create({ data: { userId: patient.userId, title: "Doctor consent request", message: `${req.user!.fullName} needs access to begin your assigned consultation.`, relatedEntityType: "AccessRequest", relatedEntityId: request.id } });
  ok(res.status(201), request, "Consent request sent to patient");
}));

router.post("/doctor/cases/:id/start", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const careCase = await prisma.careCase.findFirst({ where: { id: req.params.id, assignedDoctorUserId: req.user!.id } });
  if (!careCase) throw new ApiError(404, "Assigned care case not found");
  if (careCase.status === CareCaseStatus.COMPLETED || careCase.status === CareCaseStatus.CANCELLED) throw new ApiError(409, "This care case is closed");
  if (!(await hasPatientAccess(req.user!.id, careCase.patientId, ACCESS_CATEGORIES.FULL))) throw new ApiError(403, "Patient must approve full clinical access before the session can start");
  ok(res, await prisma.careCase.update({ where: { id: careCase.id }, data: { status: CareCaseStatus.IN_CONSULTATION } }), "Consultation session started");
}));

router.post("/doctor/cases/:id/diagnostic-orders", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const body = z.object({ testName: z.string().min(2), clinicalReason: z.string().min(3), instructions: z.string().optional() }).parse(req.body);
  const careCase = await prisma.careCase.findFirst({ where: { id: req.params.id, assignedDoctorUserId: req.user!.id } });
  if (!careCase) throw new ApiError(404, "Assigned care case not found");
  if (careCase.status === CareCaseStatus.COMPLETED || careCase.status === CareCaseStatus.CANCELLED) throw new ApiError(409, "Tests cannot be ordered for a closed care case");
  if (!(await hasPatientAccess(req.user!.id, careCase.patientId, ACCESS_CATEGORIES.FULL))) throw new ApiError(403, "Full clinical access is required");
  const order = await prisma.diagnosticOrder.create({ data: { careCaseId: careCase.id, patientId: careCase.patientId, doctorUserId: req.user!.id, hospitalUserId: careCase.hospitalUserId, ...body } });
  await prisma.careCase.update({ where: { id: careCase.id }, data: { status: CareCaseStatus.TESTS_ORDERED } });
  if (careCase.hospitalUserId) await prisma.notification.create({ data: { userId: careCase.hospitalUserId, title: "Diagnostic test requested", message: `${req.user!.fullName} ordered ${body.testName}. Assign a laboratory.`, relatedEntityType: "DiagnosticOrder", relatedEntityId: order.id } });
  ok(res.status(201), order, "Diagnostic order sent to hospital");
}));

router.post("/doctor/cases/:id/follow-up", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const body = z.object({ doctorNotes: z.string().min(3), followUpDate: z.string().optional(), completed: z.boolean().default(false) }).parse(req.body);
  const careCase = await prisma.careCase.findFirst({ where: { id: req.params.id, assignedDoctorUserId: req.user!.id } });
  if (!careCase) throw new ApiError(404, "Assigned care case not found");
  if (!(await hasPatientAccess(req.user!.id, careCase.patientId, ACCESS_CATEGORIES.FULL))) throw new ApiError(403, "Full clinical access is required");
  if (body.completed) {
    const pendingTests = await prisma.diagnosticOrder.count({ where: { careCaseId: careCase.id, status: { notIn: [DiagnosticOrderStatus.COMPLETED, DiagnosticOrderStatus.CANCELLED] } } });
    if (pendingTests > 0) throw new ApiError(409, "Complete or cancel all diagnostic tests before closing the care case");
  }
  const followUpDate = body.followUpDate ? new Date(body.followUpDate) : null;
  if (followUpDate && Number.isNaN(followUpDate.getTime())) throw new ApiError(400, "Follow-up date is invalid");
  if (!body.completed && (!followUpDate || followUpDate <= new Date())) throw new ApiError(400, "Choose a future follow-up date or complete the care case");
  const updated = await prisma.careCase.update({ where: { id: careCase.id }, data: { doctorNotes: body.doctorNotes, followUpDate: body.completed ? null : followUpDate, status: body.completed ? CareCaseStatus.COMPLETED : CareCaseStatus.FOLLOW_UP } });
  const patient = await prisma.patientProfile.findUniqueOrThrow({ where: { id: careCase.patientId } });
  await prisma.notification.create({ data: { userId: patient.userId, title: body.completed ? "Care case completed" : "Follow-up scheduled", message: body.completed ? `${req.user!.fullName} completed your care case.` : `Your follow-up is scheduled for ${updated.followUpDate?.toLocaleString()}.`, relatedEntityType: "CareCase", relatedEntityId: careCase.id } });
  ok(res, updated, body.completed ? "Care case completed" : "Follow-up scheduled");
}));

router.get("/hospital/diagnostic-orders", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const orders = await prisma.diagnosticOrder.findMany({ where: { hospitalUserId: req.user!.id }, include: { careCase: { include: { patient: { select: patientIdentitySelect } } } }, orderBy: { orderedAt: "desc" } });
  const [users, reports] = await Promise.all([usersByIds(orders.flatMap((order) => [order.doctorUserId, order.laboratoryUserId])), reportsByIds(orders.map((order) => order.reportMedicalRecordId))]);
  ok(res, orders.map((order) => ({ ...order, doctor: users.get(order.doctorUserId), laboratory: order.laboratoryUserId ? users.get(order.laboratoryUserId) : undefined, report: order.reportMedicalRecordId ? reports.get(order.reportMedicalRecordId) : undefined })));
}));

router.get("/hospital/diagnostic-reports", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const orders = await prisma.diagnosticOrder.findMany({ where: { hospitalUserId: req.user!.id, reportMedicalRecordId: { not: null } }, select: { reportMedicalRecordId: true }, orderBy: { completedAt: "desc" } });
  const reports = await reportsByIds(orders.map((order) => order.reportMedicalRecordId));
  ok(res, orders.flatMap((order) => {
    const report = reports.get(order.reportMedicalRecordId!);
    return report ? [report] : [];
  }));
}));

router.get("/doctor/diagnostic-reports", requireRoles(Role.DOCTOR), asyncHandler(async (req, res) => {
  const orders = await prisma.diagnosticOrder.findMany({ where: { doctorUserId: req.user!.id, reportMedicalRecordId: { not: null } }, select: { reportMedicalRecordId: true }, orderBy: { completedAt: "desc" } });
  const reports = await reportsByIds(orders.map((order) => order.reportMedicalRecordId));
  ok(res, orders.flatMap((order) => {
    const report = reports.get(order.reportMedicalRecordId!);
    return report ? [report] : [];
  }));
}));

router.get("/hospital/laboratories", requireRoles(Role.HOSPITAL), asyncHandler(async (_req, res) => {
  ok(res, await prisma.user.findMany({ where: { role: Role.LABORATORY, isActive: true, laboratoryProfile: { verificationStatus: "VERIFIED" } }, select: { ...publicUserSelect, laboratoryProfile: true }, orderBy: { fullName: "asc" } }));
}));

router.post("/hospital/diagnostic-orders/:id/assign-lab", requireRoles(Role.HOSPITAL), asyncHandler(async (req, res) => {
  const { laboratoryUserId } = z.object({ laboratoryUserId: z.string() }).parse(req.body);
  const order = await prisma.diagnosticOrder.findFirst({ where: { id: req.params.id, hospitalUserId: req.user!.id } });
  if (!order) throw new ApiError(404, "Diagnostic order not found");
  if (order.status === DiagnosticOrderStatus.COMPLETED || order.status === DiagnosticOrderStatus.CANCELLED) throw new ApiError(409, "A closed diagnostic order cannot be reassigned");
  const lab = await prisma.user.findFirst({ where: { id: laboratoryUserId, role: Role.LABORATORY, isActive: true, laboratoryProfile: { verificationStatus: "VERIFIED" } } });
  if (!lab) throw new ApiError(400, "Select an available verified laboratory");
  const updated = await prisma.diagnosticOrder.update({ where: { id: order.id }, data: { laboratoryUserId: lab.id, assignedAt: new Date(), status: DiagnosticOrderStatus.LAB_ASSIGNED } });
  await prisma.notification.create({ data: { userId: lab.id, title: "Diagnostic test assigned", message: `${order.testName} was assigned to your laboratory.`, relatedEntityType: "DiagnosticOrder", relatedEntityId: order.id } });
  ok(res, updated, "Laboratory assigned to diagnostic order");
}));

router.get("/laboratory/orders", requireRoles(Role.LABORATORY), asyncHandler(async (req, res) => {
  const orders = await prisma.diagnosticOrder.findMany({ where: { laboratoryUserId: req.user!.id }, include: { careCase: { include: { patient: { select: patientIdentitySelect } } } }, orderBy: { assignedAt: "desc" } });
  const [users, reports] = await Promise.all([usersByIds(orders.map((order) => order.doctorUserId)), reportsByIds(orders.map((order) => order.reportMedicalRecordId))]);
  ok(res, orders.map((order) => ({ ...order, doctor: users.get(order.doctorUserId), report: order.reportMedicalRecordId ? reports.get(order.reportMedicalRecordId) : undefined })));
}));

router.get("/diagnostic-reports/:recordId/download", asyncHandler(async (req, res) => {
  const order = await prisma.diagnosticOrder.findFirst({ where: { reportMedicalRecordId: req.params.recordId }, include: { careCase: { include: { patient: true } } } });
  if (!order) throw new ApiError(404, "Diagnostic report not found");
  const allowed = req.user!.role === Role.ADMIN ||
    (req.user!.role === Role.PATIENT && order.careCase.patient.userId === req.user!.id) ||
    (req.user!.role === Role.DOCTOR && order.doctorUserId === req.user!.id) ||
    (req.user!.role === Role.HOSPITAL && order.hospitalUserId === req.user!.id) ||
    (req.user!.role === Role.LABORATORY && order.laboratoryUserId === req.user!.id);
  if (!allowed) throw new ApiError(403, "You do not have permission to download this diagnostic report");
  const record = await prisma.medicalRecord.findUnique({ where: { id: req.params.recordId } });
  if (!record?.filePath) throw new ApiError(404, "Diagnostic report file is unavailable");
  const root = path.resolve(process.cwd(), env.UPLOAD_DIR);
  const fullPath = path.resolve(record.filePath);
  const relativePath = path.relative(root, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath) || !fs.existsSync(fullPath)) throw new ApiError(404, "Diagnostic report file no longer exists");
  await writeAudit({ actorUserId: req.user!.id, patientId: record.patientId, action: "DIAGNOSTIC_REPORT_DOWNLOADED", entityType: "MedicalRecord", entityId: record.id, ipAddress: req.ip });
  res.download(fullPath, record.originalFileName ?? path.basename(fullPath));
}));

router.post("/laboratory/orders/:id/start", requireRoles(Role.LABORATORY), asyncHandler(async (req, res) => {
  const order = await prisma.diagnosticOrder.findFirst({ where: { id: req.params.id, laboratoryUserId: req.user!.id } });
  if (!order) throw new ApiError(404, "Assigned diagnostic order not found");
  if (order.status !== DiagnosticOrderStatus.LAB_ASSIGNED) throw new ApiError(409, "Only a newly assigned test can be started");
  ok(res, await prisma.diagnosticOrder.update({ where: { id: order.id }, data: { status: DiagnosticOrderStatus.IN_PROGRESS } }), "Diagnostic test started");
}));

router.post("/laboratory/orders/:id/complete", requireRoles(Role.LABORATORY), reportUpload.single("file") as any, asyncHandler(async (req, res) => {
  const order = await prisma.diagnosticOrder.findFirst({ where: { id: req.params.id, laboratoryUserId: req.user!.id }, include: { careCase: true } });
  if (!order) throw new ApiError(404, "Assigned diagnostic order not found");
  if (order.status !== DiagnosticOrderStatus.IN_PROGRESS) throw new ApiError(409, "Start the diagnostic test before completing it");
  if (!req.file) throw new ApiError(400, "Completed diagnostic report file is required");
  validateUploadedFile(req.file);
  const body = z.object({ resultSummary: z.string().min(3) }).parse(req.body);
  const lab = await prisma.laboratoryProfile.findUniqueOrThrow({ where: { userId: req.user!.id } });
  const fileHash = await hashFile(req.file.path);
  const metadataHash = hashMetadata({ diagnosticOrderId: order.id, careCaseId: order.careCaseId, testName: order.testName, laboratoryId: lab.id });
  const patient = await prisma.patientProfile.findUniqueOrThrow({ where: { id: order.patientId }, select: { userId: true } });
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.diagnosticOrder.updateMany({ where: { id: order.id, laboratoryUserId: req.user!.id, status: DiagnosticOrderStatus.IN_PROGRESS }, data: { completedAt: new Date() } });
    if (claimed.count !== 1) throw new ApiError(409, "This diagnostic test has already been completed or changed");
    const record = await tx.medicalRecord.create({ data: { patientId: order.patientId, creatorUserId: req.user!.id, creatorOrganizationId: lab.id, recordType: RecordType.LAB_REPORT, title: `${order.testName} report`, description: body.resultSummary, recordDate: new Date(), filePath: path.resolve(req.file!.path), originalFileName: req.file!.originalname, mimeType: req.file!.mimetype, fileSize: req.file!.size, fileHash, metadataHash } });
    const diagnosticOrder = await tx.diagnosticOrder.update({ where: { id: order.id }, data: { reportMedicalRecordId: record.id, status: DiagnosticOrderStatus.COMPLETED, completedAt: new Date() } });
    await tx.careCase.update({ where: { id: order.careCaseId }, data: { status: CareCaseStatus.FOLLOW_UP } });
    const notifications = [
      tx.notification.create({ data: { userId: patient.userId, title: "Diagnostic report completed", message: `Your ${order.testName} report is ready.`, relatedEntityType: "MedicalRecord", relatedEntityId: record.id } }),
      tx.notification.create({ data: { userId: order.doctorUserId, title: "Diagnostic report completed", message: `${order.testName} results are ready for review.`, relatedEntityType: "MedicalRecord", relatedEntityId: record.id } })
    ];
    if (order.hospitalUserId) notifications.push(tx.notification.create({ data: { userId: order.hospitalUserId, title: "Diagnostic report completed", message: `${order.testName} results are ready in Diagnostic Orders.`, relatedEntityType: "MedicalRecord", relatedEntityId: record.id } }));
    await Promise.all(notifications);
    return { record, diagnosticOrder };
  });
  ok(res, { ...result, record: withoutStoragePath(result.record) }, "Diagnostic report delivered to patient and doctor; anchor it with MetaMask");
}));

export default router;
