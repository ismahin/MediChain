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

const prisma = new PrismaClient();

async function upsertUser(email: string, password: string, data: Omit<Parameters<typeof prisma.user.upsert>[0]["create"], "passwordHash" | "email">) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    update: { ...data, passwordHash },
    create: { ...data, email, passwordHash }
  });
}

async function main() {
  const admin = await upsertUser("admin@medichain.demo", "Admin@12345", {
    fullName: "MediChain Admin",
    phone: "+8801700000001",
    role: Role.ADMIN,
    isActive: true
  });

  const patientUser = await upsertUser("patient@medichain.demo", "Patient@12345", {
    fullName: "Ayesha Rahman",
    phone: "+8801700000002",
    role: Role.PATIENT,
    walletAddress: "0x0000000000000000000000000000000000000001",
    isActive: true
  });

  const patient = await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      healthId: "MCH-2026-000001",
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

  const doctorUser = await upsertUser("doctor@medichain.demo", "Doctor@12345", {
    fullName: "Dr. Farhan Ahmed",
    phone: "+8801700000003",
    role: Role.DOCTOR,
    walletAddress: "0x0000000000000000000000000000000000000002",
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

  const hospitalUser = await upsertUser("hospital@medichain.demo", "Hospital@12345", {
    fullName: "CityCare Hospital",
    phone: "+8801700000004",
    role: Role.HOSPITAL,
    walletAddress: "0x0000000000000000000000000000000000000003",
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

  const labUser = await upsertUser("lab@medichain.demo", "Lab@12345", {
    fullName: "Prime Diagnostics Lab",
    phone: "+8801700000005",
    role: Role.LABORATORY,
    walletAddress: "0x0000000000000000000000000000000000000004",
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
      description: "Seeded demo prescription metadata. Anchor after Sepolia deployment.",
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

  await prisma.accessRequest.create({
    data: {
      patientId: patient.id,
      requesterUserId: doctorUser.id,
      requesterRole: Role.DOCTOR,
      requestedCategories: ["Prescriptions only", "Allergies and emergency info"],
      reason: "Follow-up consultation review",
      requestedDurationHours: 72,
      status: AccessRequestStatus.PENDING
    }
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: patientUser.id,
        title: "Welcome to MediChain",
        message: "Your Health ID MCH-2026-000001 is ready.",
        type: NotificationType.SUCCESS
      },
      {
        userId: patientUser.id,
        title: "Access request pending",
        message: "Dr. Farhan Ahmed requested limited access to your records.",
        type: NotificationType.INFO,
        relatedEntityType: "AccessRequest"
      }
    ]
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
