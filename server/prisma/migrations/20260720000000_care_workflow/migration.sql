CREATE TABLE `CareCase` (
  `id` VARCHAR(191) NOT NULL,
  `patientId` VARCHAR(191) NOT NULL,
  `problemTitle` VARCHAR(191) NOT NULL,
  `problemDetails` TEXT NOT NULL,
  `preferredDoctorUserId` VARCHAR(191) NULL,
  `hospitalUserId` VARCHAR(191) NULL,
  `assignedDoctorUserId` VARCHAR(191) NULL,
  `appointmentDate` DATETIME(3) NOT NULL,
  `status` ENUM('SUBMITTED','DOCTOR_ASSIGNED','CONSENT_PENDING','IN_CONSULTATION','TESTS_ORDERED','FOLLOW_UP','COMPLETED','CANCELLED') NOT NULL DEFAULT 'SUBMITTED',
  `hospitalNotes` TEXT NULL,
  `doctorNotes` TEXT NULL,
  `followUpDate` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `CareCase_patientId_status_idx` (`patientId`, `status`),
  INDEX `CareCase_hospitalUserId_status_idx` (`hospitalUserId`, `status`),
  INDEX `CareCase_assignedDoctorUserId_status_idx` (`assignedDoctorUserId`, `status`),
  CONSTRAINT `CareCase_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `PatientProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CaseDocument` (
  `id` VARCHAR(191) NOT NULL,
  `careCaseId` VARCHAR(191) NOT NULL,
  `filePath` VARCHAR(191) NOT NULL,
  `originalFileName` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `fileHash` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `CaseDocument_careCaseId_idx` (`careCaseId`),
  CONSTRAINT `CaseDocument_careCaseId_fkey` FOREIGN KEY (`careCaseId`) REFERENCES `CareCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DiagnosticOrder` (
  `id` VARCHAR(191) NOT NULL,
  `careCaseId` VARCHAR(191) NOT NULL,
  `patientId` VARCHAR(191) NOT NULL,
  `doctorUserId` VARCHAR(191) NOT NULL,
  `hospitalUserId` VARCHAR(191) NULL,
  `laboratoryUserId` VARCHAR(191) NULL,
  `testName` VARCHAR(191) NOT NULL,
  `clinicalReason` TEXT NOT NULL,
  `instructions` TEXT NULL,
  `status` ENUM('REQUESTED','LAB_ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'REQUESTED',
  `reportMedicalRecordId` VARCHAR(191) NULL,
  `orderedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `assignedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `DiagnosticOrder_careCaseId_status_idx` (`careCaseId`, `status`),
  INDEX `DiagnosticOrder_hospitalUserId_status_idx` (`hospitalUserId`, `status`),
  INDEX `DiagnosticOrder_laboratoryUserId_status_idx` (`laboratoryUserId`, `status`),
  CONSTRAINT `DiagnosticOrder_careCaseId_fkey` FOREIGN KEY (`careCaseId`) REFERENCES `CareCase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
