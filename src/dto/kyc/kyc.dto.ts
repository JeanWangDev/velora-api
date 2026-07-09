import type { KycVerification } from "@/db/models/kyc";

export interface KycVerificationDto {
  status: KycVerification["status"];
  idType: KycVerification["idType"];
  fullName: string;
  idNumber: string;
  countryIso: string;
  address: string | null;
  validUntil: string | null;
  docFrontName: string | null;
  docBackName: string | null;
  rejectReason: string | null;
  submittedAt: number | null;
  reviewedAt: number | null;
  diditSessionId: string | null;
}

/** 对身份证号做脱敏，仅保留前 4 位与后 4 位 */
function maskIdNumber(idNumber: string): string {
  const value = idNumber.trim();
  if (value.length <= 8) {
    return value;
  }
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

export interface AdminKycVerificationDto extends KycVerificationDto {
  userId: number;
  email: string | null;
}

export function toAdminKycVerificationDto(row: KycVerification): AdminKycVerificationDto {
  return {
    ...toKycVerificationDto(row, { maskId: false }),
    userId: row.userId,
    email: row.user?.email ?? null,
  };
}

export function toKycVerificationDto(
  row: KycVerification,
  options?: { maskId?: boolean },
): KycVerificationDto {
  const maskId = options?.maskId ?? true;
  return {
    status: row.status,
    idType: row.idType,
    fullName: row.fullName,
    idNumber: maskId ? maskIdNumber(row.idNumber) : row.idNumber,
    countryIso: row.countryIso,
    address: row.address ?? null,
    validUntil: row.validUntil ?? null,
    docFrontName: row.docFrontName ?? null,
    docBackName: row.docBackName ?? null,
    rejectReason: row.rejectReason ?? null,
    submittedAt: row.submittedAt ? row.submittedAt.getTime() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.getTime() : null,
    diditSessionId: row.diditSessionId ?? null,
  };
}
