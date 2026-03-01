import axios from "axios";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RecommendedAction =
  | "PROCEED"
  | "CHALLENGE_OTP"
  | "BLOCK_ALL"
  | "MANUAL_REVIEW";

export type RoutingChannel = "VA_BCA" | "VA_MANDIRI" | "QRIS" | "PAYLATER";

export interface QwenFraudDecisionInput {
  phone: string;
  ip: string;
  deviceFingerprint: string;
  amount: number;
  merchantId: string;
  ringDetected: boolean;
  ringScore: number;
  ringEdges: Array<{
    source: string;
    target: string;
    relation: string;
    score: number | null;
  }>;
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

  const systemPrompt = `
Anda adalah engine fraud detection untuk payment gateway di Indonesia.
Tugas Anda:
- Menilai risiko transaksi berdasarkan metadata dan informasi ring graph (fraud ring).
- Mengeluarkan keputusan dalam format JSON SAJA, tanpa teks lain.
- Bahasa penjelasan WAJIB Bahasa Indonesia, jelas dan singkat.

Field JSON yang WAJIB:
- "risk_level": salah satu dari ["LOW","MEDIUM","HIGH","CRITICAL"]
- "explanation": teks Bahasa Indonesia yang menjelaskan alasan utama.
- "recommended_action": salah satu dari ["PROCEED","CHALLENGE_OTP","BLOCK_ALL","MANUAL_REVIEW"]
- "routing_suggestion": salah satu dari ["VA_BCA","VA_MANDIRI","QRIS","PAYLATER"]

Pertimbangkan:
- Phone / device / IP yang berulang dalam waktu singkat.
- Hubungan dengan phone lain melalui shared device / IP / transfer hop.
- Jumlah ringScore: semakin tinggi semakin berisiko.
- Konteks merchant payment Indonesia (VA, QRIS, PayLater).

Selalu kembalikan output yang valid JSON dan mudah di-parse.
`;

  const userContent = {
    role: "user",
    content: [
      {
        role: "user",
        content: `Berikut data transaksi dan graph ring:\n${JSON.stringify(input, null, 2)}\n\nBerikan keputusan JSON sesuai spesifikasi.`,
      },
    ],
  };

  try {
    const response = await axios.post(
      endpoint,
      {
        model,
        input: {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userContent) },
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
    // Fallback konservatif jika Qwen gagal: HIGH risk & manual review.
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

