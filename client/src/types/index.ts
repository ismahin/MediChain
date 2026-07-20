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
  description?: string;
  fileHash: string;
  metadataHash: string;
  blockchainStatus: "PENDING" | "ANCHORED" | "VERIFIED" | "FAILED" | "RETRYING";
  blockchainTxHash?: string;
  blockchainBlockNumber?: number;
  recordDate: string;
  creator?: User;
  prescription?: {
    id: string;
    diagnosis: string;
    notes?: string | null;
    followUpDate?: string | null;
    medications: Array<{ id: string; medicineName: string; dosage: string; frequency: string; duration: string; instructions?: string | null }>;
  } | null;
};
