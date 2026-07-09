import { config } from "@/config";
import { BadRequestError } from "@/errors/app-error";

const DIDIT_API_BASE = "https://verification.didit.me";

export interface DiditSessionResponse {
  session_id: string;
  url: string;
  status: string;
  vendor_data?: string;
}

export interface DiditIdVerification {
  node_id?: string;
  status?: string;
  document_type?: string;
  document_subtype?: string;
  document_number?: string;
  personal_number?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  nationality?: string;
  issuing_state?: string;
  address?: string;
  formatted_address?: string;
  expiration_date?: string;
  front_image?: string;
  back_image?: string;
  warnings?: Array<{ short_description?: string; long_description?: string }>;
}

export interface DiditDecision {
  session_id?: string;
  status?: string;
  vendor_data?: string;
  id_verifications?: DiditIdVerification[];
  reviews?: Array<{ reason?: string; comment?: string }>;
}

export interface ParsedDiditKyc {
  status: "pending" | "verified" | "rejected";
  idType: "id_card" | "passport";
  fullName: string;
  idNumber: string;
  countryIso: string;
  address?: string;
  validUntil?: string;
  docFrontName?: string;
  docBackName?: string;
  rejectReason?: string;
}

function assertDiditConfigured() {
  if (!config.didit.enabled) {
    throw new BadRequestError("Didit KYC 未启用");
  }
  if (!config.didit.apiKey.trim()) {
    throw new BadRequestError("Didit API Key 未配置");
  }
  if (!config.didit.workflowId.trim()) {
    throw new BadRequestError("Didit Workflow ID 未配置");
  }
}

async function diditFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${config.didit.baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.didit.apiKey,
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const message =
      typeof json === "object" &&
      json !== null &&
      "detail" in json &&
      typeof (json as { detail: unknown }).detail === "string"
        ? (json as { detail: string }).detail
        : `Didit API 错误 (${res.status})`;
    throw new BadRequestError(message);
  }

  return json as T;
}

function mapCountryIso(value?: string | null): string {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return "US";
  if (raw.length === 2) return raw;
  // Common 3-letter → 2-letter (extend as needed)
  const iso3to2: Record<string, string> = {
    CHN: "CN",
    USA: "US",
    GBR: "GB",
    ESP: "ES",
    DEU: "DE",
    FRA: "FR",
    JPN: "JP",
    KOR: "KR",
    HKG: "HK",
    TWN: "TW",
    SGP: "SG",
    AUS: "AU",
    CAN: "CA",
  };
  return iso3to2[raw] ?? raw.slice(0, 2);
}

function inferIdType(doc?: DiditIdVerification): "id_card" | "passport" {
  const type = `${doc?.document_type ?? ""} ${doc?.document_subtype ?? ""}`.toLowerCase();
  if (type.includes("passport")) {
    return "passport";
  }
  return "id_card";
}

function pickIdVerification(decision: DiditDecision): DiditIdVerification | undefined {
  const items = decision.id_verifications ?? [];
  const approved = items.find((item) => item.status === "Approved");
  return approved ?? items[0];
}

/** Map Didit session status to Velora KYC status. */
export function mapDiditStatus(diditStatus: string): ParsedDiditKyc["status"] {
  switch (diditStatus) {
    case "Approved":
      return "verified";
    case "Declined":
      return "rejected";
    case "In Review":
    case "In Progress":
    case "Not Started":
    case "Resubmitted":
    case "Awaiting User":
      return "pending";
    case "Abandoned":
    case "Expired":
    case "Kyc Expired":
      return "rejected";
    default:
      return "pending";
  }
}

function truncate(value: string | undefined | null, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

/** Extract KYC fields from Didit decision payload. */
export function parseDiditDecision(
  decision: DiditDecision,
  sessionStatus?: string,
): ParsedDiditKyc {
  const status = mapDiditStatus(sessionStatus ?? decision.status ?? "In Progress");
  const idDoc = pickIdVerification(decision);

  const fullName =
    idDoc?.full_name?.trim() ||
    [idDoc?.first_name, idDoc?.last_name].filter(Boolean).join(" ").trim() ||
    "—";

  const idNumber =
    idDoc?.document_number?.trim() ||
    idDoc?.personal_number?.trim() ||
    "—";

  const countryIso = mapCountryIso(idDoc?.nationality ?? idDoc?.issuing_state);

  let rejectReason: string | undefined;
  if (status === "rejected") {
    const warning = idDoc?.warnings?.[0];
    rejectReason =
      warning?.short_description ||
      warning?.long_description ||
      decision.reviews?.[0]?.reason ||
      decision.reviews?.[0]?.comment ||
      "身份验证未通过";
  }

  return {
    status,
    idType: inferIdType(idDoc),
    fullName,
    idNumber,
    countryIso,
    address: truncate(idDoc?.formatted_address ?? idDoc?.address, 255),
    validUntil: idDoc?.expiration_date ?? undefined,
    // Didit 返回的是远程图片 URL，不写入 doc 字段（varchar 255 会溢出）
    docFrontName: undefined,
    docBackName: undefined,
    rejectReason: truncate(rejectReason, 255),
  };
}

export class DiditService {
  static isEnabled(): boolean {
    return config.didit.enabled && Boolean(config.didit.apiKey.trim());
  }

  /** Create a Didit verification session for a Velora user. */
  static async createSession(input: {
    userId: number;
    callbackUrl?: string;
    language?: string;
  }): Promise<DiditSessionResponse> {
    assertDiditConfigured();

    const callback =
      input.callbackUrl?.trim() ||
      config.didit.callbackUrl.trim() ||
      undefined;

    const body: Record<string, string> = {
      workflow_id: config.didit.workflowId,
      vendor_data: String(input.userId),
    };
    if (callback) {
      body.callback = callback;
      body.callback_method = "both";
    }
    if (input.language) {
      body.language = input.language;
    }

    return diditFetch<DiditSessionResponse>("/v3/session/", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Fetch session decision (polling / callback sync). */
  static async getDecision(sessionId: string): Promise<{
    status: string;
    decision: DiditDecision;
  }> {
    assertDiditConfigured();

    const data = await diditFetch<DiditDecision & { status?: string }>(
      `/v3/session/${encodeURIComponent(sessionId)}/decision/`,
      { method: "GET" },
    );

    return {
      status: data.status ?? "In Progress",
      decision: data,
    };
  }
}
