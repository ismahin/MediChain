import bcrypt from "bcryptjs";
import {
  AccessRequestStatus,
  BlockchainStatus,
  NotificationType,
  PrismaClient,
  RecordType,
  Role,
  VerificationStatus
} from "@prisma/client";
import { sha256Hex, stableStringify } from "../src/utils/hash.js";
import { demoAccounts, env } from "../src/config/env.js";

const prisma = new PrismaClient();

async function upsertUser(email: string, password: string, data: Omit<Parameters<typeof prisma.user.upsert>[0]["create"], "passwordHash" | "email">) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  return prisma.user.upsert({
    where: { email },
    update: { ...data, passwordHash },
    create: { ...data, email, passwordHash }
  });
}

function demoCredential(role: Role) {
  const account = demoAccounts.find((candidate) => candidate.role === role);
  if (!account) throw new Error(`Missing ${role} credentials in DEMO_ACCOUNTS_JSON`);
  return account;
}

async function main() {
  if (!env.DEMO_MODE) {
    console.log("Demo seeding is disabled. Set DEMO_MODE=true and configure DEMO_ACCOUNTS_JSON to install demo fixtures.");
    return;
  }
  const adminCredential = demoCredential(Role.ADMIN);
  const patientCredential = demoCredential(Role.PATIENT);
  const doctorCredential = demoCredential(Role.DOCTOR);
  const hospitalCredential = demoCredential(Role.HOSPITAL);
  const laboratoryCredential = demoCredential(Role.LABORATORY);

  const admin = await upsertUser(adminCredential.email, adminCredential.password, {
    fullName: "MediChain Admin",
    phone: "+8801700000001",
    role: Role.ADMIN,
    isActive: true
  });

  const patientUser = await upsertUser(patientCredential.email, patientCredential.password, {
    fullName: "Ayesha Rahman",
    phone: "+8801700000002",
    role: Role.PATIENT,
    isActive: true
  });

  const patient = await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      healthId: `${env.HEALTH_ID_PREFIX}-DEMO-000001`,
      nidOrBirthCertificate: "19981234567000123",
      dateOfBirth: new Date("1998-04-12"),
      gender: "Female",
      bloodGroup: "B+",
      allergies: ["Penicillin"],
      chronicConditions: ["Mild asthma"],
      currentMedications: ["Salbutamol inhaler as needed"],
      surgeryHistory: [],
      vaccinationHistory: ["COVID-19", "Hepatitis B"],
      emergencyContactName: "Karim Rahman",
      emergencyContactPhone: "+8801700000099",
      address: "Dhanmondi, Dhaka",
      emergencyAccessEnabled: true
    }
  });

  const doctorUser = await upsertUser(doctorCredential.email, doctorCredential.password, {
    fullName: "Dr. Farhan Ahmed",
    phone: "+8801700000003",
    role: Role.DOCTOR,
    isActive: true
  });

  const doctor = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: { verificationStatus: VerificationStatus.VERIFIED },
    create: {
      userId: doctorUser.id,
      medicalRegistrationNumber: "BMDC-778812",
      specialization: "Internal Medicine",
      organizationName: "MediCare Clinic",
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id
    }
  });

  const hospitalUser = await upsertUser(hospitalCredential.email, hospitalCredential.password, {
    fullName: "CityCare Hospital",
    phone: "+8801700000004",
    role: Role.HOSPITAL,
    isActive: true
  });

  await prisma.hospitalProfile.upsert({
    where: { userId: hospitalUser.id },
    update: { verificationStatus: VerificationStatus.VERIFIED },
    create: {
      userId: hospitalUser.id,
      hospitalName: "CityCare Hospital",
      licenseNumber: "HOSP-DHK-2026-001",
      address: "Gulshan, Dhaka",
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id
    }
  });

  const labUser = await upsertUser(laboratoryCredential.email, laboratoryCredential.password, {
    fullName: "Prime Diagnostics Lab",
    phone: "+8801700000005",
    role: Role.LABORATORY,
    isActive: true
  });

  await prisma.laboratoryProfile.upsert({
    where: { userId: labUser.id },
    update: { verificationStatus: VerificationStatus.VERIFIED },
    create: {
      userId: labUser.id,
      laboratoryName: "Prime Diagnostics Lab",
      licenseNumber: "LAB-DHK-2026-001",
      address: "Banani, Dhaka",
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id
    }
  });

  const recordPayload = {
    patientHealthId: patient.healthId,
    title: "Demo / pending deployment - General Consultation",
    diagnosis: "Seasonal allergic rhinitis",
    issuedBy: doctorUser.fullName
  };
  const fileHash = sha256Hex(stableStringify(recordPayload));
  const metadataHash = sha256Hex(stableStringify({ recordPayload, recordType: RecordType.PRESCRIPTION }));

  const record = await prisma.medicalRecord.upsert({
    where: { fileHash },
    update: {},
    create: {
      patientId: patient.id,
      creatorUserId: doctorUser.id,
      recordType: RecordType.PRESCRIPTION,
      title: "Demo / pending deployment - Allergy prescription",
      description: "Seeded demo prescription metadata. Anchor after blockchain deployment.",
      recordDate: new Date(),
      fileHash,
      metadataHash,
      blockchainStatus: BlockchainStatus.PENDING,
      blockchainError: "Demo / pending deployment"
    }
  });

  await prisma.prescription.upsert({
    where: { medicalRecordId: record.id },
    update: {},
    create: {
      medicalRecordId: record.id,
      patientId: patient.id,
      doctorId: doctor.id,
      diagnosis: "Seasonal allergic rhinitis",
      notes: "Avoid known allergens and follow up if symptoms persist.",
      followUpDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      medications: {
        create: [
          {
            medicineName: "Cetirizine",
            dosage: "10 mg",
            frequency: "Once daily",
            duration: "7 days",
            instructions: "Take at night after food"
          }
        ]
      }
    }
  });

  const seedRequest = await prisma.accessRequest.findFirst({
    where: { patientId: patient.id, requesterUserId: doctorUser.id, reason: "Follow-up consultation review" }
  });
  if (!seedRequest) {
    await prisma.accessRequest.create({
      data: {
        patientId: patient.id,
        requesterUserId: doctorUser.id,
        requesterRole: Role.DOCTOR,
        requestedCategories: ["Prescriptions only", "Allergies and emergency info"],
        reason: "Follow-up consultation review",
        requestedDurationHours: Math.min(72, env.MAX_ACCESS_DURATION_HOURS),
        status: AccessRequestStatus.PENDING
      }
    });
  }

  const notifications = [
    {
      userId: patientUser.id,
      title: "Welcome to MediChain",
      message: `Your Health ID ${patient.healthId} is ready.`,
      type: NotificationType.SUCCESS
    },
    {
      userId: patientUser.id,
      title: "Access request pending",
      message: "Dr. Farhan Ahmed requested limited access to your records.",
      type: NotificationType.INFO,
      relatedEntityType: "AccessRequest"
    }
  ];
  for (const notification of notifications) {
    const existing = await prisma.notification.findFirst({ where: { userId: notification.userId, title: notification.title, message: notification.message } });
    if (!existing) await prisma.notification.create({ data: notification });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
