ALTER TABLE `HospitalDoctor`
  ADD COLUMN `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `respondedAt` DATETIME(3) NULL;

ALTER TABLE `HospitalDoctor`
  ALTER COLUMN `status` SET DEFAULT 'PENDING';

CREATE INDEX `HospitalDoctor_doctorUserId_status_idx`
  ON `HospitalDoctor`(`doctorUserId`, `status`);
