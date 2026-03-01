import axios from "axios";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RecommendedAction =
  | "PROCEED"
  | "CHALLENGE_OTP"
  | "BLOCK_ALL"
  | "MANUAL_REVIEW";

export type RoutingChannel = "VA_BCA" | "VA_MANDIRI" | "QRIS" | "PAYLATER";

export interface QwenFraudDecisionInput {
  // Data utama transaksi
  transactionId?: string;
  phone: string;
  ip: string;
  deviceFingerprint: string;
  amount: number;
  merchantId: string;
  timestamp?: string;

  // Hasil analisis graph / ring
  ringDetected: boolean;
  ringScore: number;
  ringEdges: Array<{
    source: string;
    target: string;
    relation: string;
    score: number | null;
  }>;

  // Metadata tambahan untuk prompt baru (opsional)
  deviceMatchPercent?: number;
  ipCluster?: string;
  fraudRiskScore?: number; // 0-100 dari Fraud Detection / internal scoring
  graphSummary?: string;
  velocityLast60Min?: number;
  availableChannels?: string[]; // contoh: ["BCA VA","Mandiri VA","QRIS Dana","PayLater Akulaku"]
}

export interface QwenFraudDecision {
  risk_level: RiskLevel;
  explanation: string;
  recommended_action: RecommendedAction;
  routing_suggestion: RoutingChannel;
}

// Panggilan ke Alibaba Cloud Qwen (Model Studio).
// Calling Alibaba Cloud Qwen (Model Studio) with structured JSON output.
export async function getFraudDecisionFromQwen(
  input: QwenFraudDecisionInput,
): Promise<QwenFraudDecision> {
  const apiKey = process.env.ALIBABA_QWEN_API_KEY;
  const endpoint =
    process.env.ALIBABA_QWEN_ENDPOINT ||
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation";
  const model = process.env.ALIBABA_QWEN_MODEL || "qwen-turbo";

  if (!apiKey) {
    throw new Error(
      "ALIBABA_QWEN_API_KEY is not defined. Set it in your environment (.env).",
    );
  }

  // Siapkan data turunan untuk prompt yang lebih kaya
  const txId = input.transactionId ?? "N/A";
  const amount = input.amount.toFixed(2);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const merchantId = input.merchantId;
  const phone1 = input.phone;

  const linkedPhonesSet = new Set<string>();
  input.ringEdges.forEach((e) => {
    if (e.source !== phone1) linkedPhonesSet.add(e.source);
    if (e.target !== phone1) linkedPhonesSet.add(e.target);
  });
  const linkedPhones =
    linkedPhonesSet.size > 0 ? Array.from(linkedPhonesSet).join(", ") : "Tidak ada";

  const deviceMatch = input.deviceMatchPercent ?? 0;
  const ipCluster = input.ipCluster ?? "Unknown cluster";
  const riskScore = input.fraudRiskScore ?? Math.min(Math.round(input.ringScore), 100);

  const graphSummary =
    input.graphSummary ??
    (input.ringDetected && input.ringEdges.length > 0
      ? `Terdapat ${input.ringEdges.length} hubungan antar nomor melalui ${[
          ...new Set(input.ringEdges.map((e) => e.relation)),
        ].join(", ")}`
      : "Tidak ada hubungan ring yang signifikan");

  const velocity = input.velocityLast60Min ?? 0;
  const channels =
    input.availableChannels && input.availableChannels.length > 0
      ? input.availableChannels.join(", ")
      : "BCA VA, Mandiri VA, QRIS, PayLater";

  const systemPrompt = `
You are an expert fraud risk analyst and intelligent payment routing agent at Paylabs, a leading Indonesian payment gateway. Your role is to analyze transaction data, detect fraud rings (especially money mule networks and phone rotation), provide clear explanations in Bahasa Indonesia, and recommend the best routing decision.

Input data:
- Transaction ID: ${txId}
- Amount: Rp ${amount}
- Timestamp: ${timestamp}
- Merchant ID: ${merchantId}
- User Phone: ${phone1}
- Linked Phones: ${linkedPhones} (comma-separated)
- Device Fingerprint Match: ${deviceMatch}% across linked users
- IP Cluster: ${ipCluster} (e.g., same subnet Jakarta Selatan)
- Risk Score from Fraud Detection: ${riskScore}/100
- Graph Path: ${graphSummary}
- Historical Velocity: ${velocity} transaksi in last 60 minutes
- Channel Available: ${channels}

Instructions:
1. Analyze for fraud ring signs: phone rotation, shared device/IP, mule layering (quick transfers), velocity spike, location anomaly.
2. Classify risk level: Low (<50), Medium (50-80), High (>80).
3. Provide short, clear explanation in Bahasa Indonesia (max 100 words).
4. Recommend action:
   - Block All
   - Challenge OTP / 3DS
   - Manual Review
   - Proceed with Smart Routing (pilih channel terbaik: least cost + high success + low fraud risk)
5. If proceed, suggest best channel from available and why.
6. Output strictly in JSON format.

Output JSON example:
{
  "risk_level": "High",
  "explanation": "Ring terdeteksi: Nomor ${phone1} dan salah satu linked phone terhubung via device fingerprint ${deviceMatch}% match + transfer cepat Rp${amount} dalam 20 menit. Pola money mule klasik.",
  "recommended_action": "Block All",
  "routing_suggestion": null,
  "confidence": 92
}
`;

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        input: {
          messages: [
            { role: "system", content: systemPrompt },
          ],
        },
        parameters: {
          result_format: "text",
          temperature: 0.1,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      },
    );

    const text: string =
      response.data?.output?.text ?? response.data?.choices?.[0]?.message?.content ?? "";

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error("Qwen response does not contain JSON object.");
    }

    const jsonStr = text.slice(firstBrace, lastBrace + 1);
    const parsed = JSON.parse(jsonStr) as QwenFraudDecision;

    return parsed;
  } catch (err) {
    console.error("[Qwen] Error calling Qwen API:", err);
    const fallback: QwenFraudDecision = {
      risk_level: "HIGH",
      explanation:
        "Qwen API gagal dipanggil, sistem default ke risiko tinggi untuk keamanan.",
      recommended_action: "MANUAL_REVIEW",
      routing_suggestion: "VA_BCA",
    };
    return fallback;
  }
}

