import crypto from "crypto";

/** Match Didit float normalisation: whole-valued floats serialise as ints. */
function shortenFloats(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(shortenFloats);
  }
  if (data !== null && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).map(([key, value]) => [
        key,
        shortenFloats(value),
      ]),
    );
  }
  if (typeof data === "number" && !Number.isInteger(data) && data % 1 === 0) {
    return Math.trunc(data);
  }
  return data;
}

/** Sort object keys recursively before re-stringifying (X-Signature-V2). */
function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.keys(obj as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((obj as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return obj;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifySignatureV2(
  jsonBody: Record<string, unknown>,
  signatureHeader: string,
  timestampHeader: string,
  secret: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  const canonical = JSON.stringify(sortKeys(shortenFloats(jsonBody)));
  const expected = crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
  return timingSafeEqualHex(expected, signatureHeader);
}

function verifySignatureSimple(
  jsonBody: Record<string, unknown>,
  signatureHeader: string,
  timestampHeader: string,
  secret: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  const canonical = [
    jsonBody.timestamp ?? "",
    jsonBody.session_id ?? "",
    jsonBody.status ?? "",
    jsonBody.webhook_type ?? "",
  ].join(":");
  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  return timingSafeEqualHex(expected, signatureHeader);
}

/** Verify Didit webhook HMAC (prefer X-Signature-V2). */
export function verifyDiditWebhookSignature(
  body: Record<string, unknown>,
  headers: {
    signatureV2?: string;
    signatureSimple?: string;
    timestamp?: string;
  },
  secret: string,
): boolean {
  if (!secret.trim() || !headers.timestamp) {
    return false;
  }

  if (
    headers.signatureV2 &&
    verifySignatureV2(body, headers.signatureV2, headers.timestamp, secret)
  ) {
    return true;
  }

  if (
    headers.signatureSimple &&
    verifySignatureSimple(body, headers.signatureSimple, headers.timestamp, secret)
  ) {
    return true;
  }

  return false;
}
