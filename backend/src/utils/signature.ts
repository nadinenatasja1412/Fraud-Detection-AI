import crypto from "crypto";

// Membuat canonical string sederhana dari payload JSON.
// Simple canonical string generation from JSON payload (sorted keys).
function canonicalizePayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  const obj = payload as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    parts.push(`${key}=${JSON.stringify(value)}`);
  }
  return parts.join("&");
}

// Fungsi utilitas untuk RSA-SHA256 signature yang akan dipakai Paylabs.
// RSA-SHA256 signing helper used for Paylabs requests.
export function signRequestRSA(
  payload: unknown,
  privateKeyPem: string,
): string {
  const canonical = canonicalizePayload(payload);

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(canonical);
  signer.end();

  const signature = signer.sign(privateKeyPem, "base64");
  return signature;
}

