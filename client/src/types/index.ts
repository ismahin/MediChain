export type Role = "PATIENT" | "DOCTOR" | "HOSPITAL" | "LABORATORY" | "ADMIN";

export type User = {
  id: string;
  fullName: string;
  email: string;
  phone?: string | null;
  role: Role;
  walletAddress?: string | null;
  isActive: boolean;
};

export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type MedicalRecord = {
  id: string;
  patientId: string;
  recordType: string;
  title: string;
  description?: string | null;
  fileHash: string;
  metadataHash: string;
  blockchainStatus: "PENDING" | "ANCHORED" | "VERIFIED" | "FAILED" | "RETRYING";
  blockchainTxHash?: string | null;
  blockchainBlockNumber?: number | null;
  blockchainTimestamp?: string | null;
  blockchainError?: string | null;
  recordDate: string;
  originalFileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdAt?: string;
  updatedAt?: string;
  creator?: User;
  patient?: {
    id: string;
    healthId: string;
    bloodGroup?: string | null;
    user: Pick<User, "id" | "fullName" | "email">;
  };
  prescription?: {
    id: string;
    diagnosis: string;
    notes?: string | null;
    followUpDate?: string | null;
    medications: Array<{ id: string; medicineName: string; dosage: string; frequency: string; duration: string; instructions?: string | null }>;
  } | null;
};
