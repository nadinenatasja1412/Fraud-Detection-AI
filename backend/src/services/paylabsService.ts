import axios from "axios";
import { signRequestRSA } from "../utils/signature";

export interface PaylabsRequestPayload {
  mid: string;
  channel: string;
  amount: number;
  phone: string;
  externalId: string;
  description?: string;
}

export interface PaylabsResponse {
  success: boolean;
  raw: any;
}

// Integrasi sederhana ke Paylabs Sandbox dengan RSA signature.
// Simple integration to Paylabs Sandbox using RSA-SHA256 signatures.
export async function sendToPaylabsSandbox(
  payload: PaylabsRequestPayload,
): Promise<PaylabsResponse> {
  const baseUrl =
    process.env.PAYLABS_BASE_URL ||
    "https://sit-merchant.paylabs.co.id";
  const endpoint = `${baseUrl}/sandbox/transactions`;

  const privateKey = process.env.PAYLABS_PRIVATE_KEY;
  const publicKey = process.env.PAYLABS_PUBLIC_KEY;
  const mid = process.env.PAYLABS_MID || payload.mid;

  if (!privateKey) {
    throw new Error(
      "PAYLABS_PRIVATE_KEY is not defined. Please store the RSA private key in the environment, NEVER hard-code it.",
    );
  }

  const body = {
    mid,
    channel: payload.channel,
    amount: payload.amount,
    phone: payload.phone,
    externalId: payload.externalId,
    description:
      payload.description ||
      "Paylabs RingShield intelligent routed transaction",
  };

  const signature = signRequestRSA(body, privateKey);

  try {
    const response = await axios.post(
      endpoint,
      body,
      {
        headers: {
          "Content-Type": "application/json",
          "X-MID": mid,
          "X-SIGNATURE": signature,
          ...(publicKey ? { "X-PUBLIC-KEY": publicKey } : {}),
        },
        timeout: 15_000,
      },
    );

    return {
      success: true,
      raw: response.data,
    };
  } catch (err: any) {
    console.error("[Paylabs] Error calling sandbox API:", err?.message || err);
    return {
      success: false,
      raw: err?.response?.data ?? { error: err?.message ?? "Unknown error" },
    };
  }
}

