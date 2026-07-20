CREATE TABLE `HospitalDoctor` (
  `id` VARCHAR(191) NOT NULL,
  `hospitalUserId` VARCHAR(191) NOT NULL,
  `doctorUserId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `HospitalDoctor_hospitalUserId_doctorUserId_key` (`hospitalUserId`, `doctorUserId`),
  INDEX `HospitalDoctor_hospitalUserId_idx` (`hospitalUserId`),
  INDEX `HospitalDoctor_doctorUserId_idx` (`doctorUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
