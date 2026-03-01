import OpenAI from 'openai';
import { Router, Request, Response } from 'express';

// --- Types & Interfaces ---
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RecommendedAction = "PROCEED" | "CHALLENGE_OTP" | "BLOCK_ALL" | "MANUAL_REVIEW";
export type RoutingChannel = "VA_BCA" | "VA_MANDIRI" | "QRIS" | "PAYLATER";

export interface QwenFraudDecisionInput {
  transactionId?: string;
  phone: string;
  ip: string;
  deviceFingerprint: string;
  amount: number;
  merchantId: string;
  timestamp?: string;
  ringDetected: boolean;
  ringScore: number;
  ringEdges: Array<{
    source: string;
    target: string;
    relation: string;
    score: number | null;
  }>;
  deviceMatchPercent?: number;
  ipCluster?: string;
  fraudRiskScore?: number;
  graphSummary?: string;
  velocityLast60Min?: number;
  availableChannels?: string[];
}

export interface QwenFraudDecision {
  risk_level: RiskLevel;
  explanation: string;
  recommended_action: RecommendedAction;
  routing_suggestion: RoutingChannel | null;
  confidence?: number;
}

// --- Service Class ---
export class AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
  }

  /**
   * 1. DEEP ANALYSIS (Comprehensive Fraud & Routing)
   * Menggabungkan logika pemrosesan data ring/graph ke dalam prompt Qwen
   */
  async deepAnalysis(input: QwenFraudDecisionInput): Promise<QwenFraudDecision> {
    try {
      // Data Preparation (Logika dari Kode Kedua)
      const txId = input.transactionId ?? "N/A";
      const amountStr = input.amount.toLocaleString('id-ID');
      const timestamp = input.timestamp ?? new Date().toISOString();
      const phone1 = input.phone;

      const linkedPhonesSet = new Set<string>();
      input.ringEdges.forEach((e) => {
        if (e.source !== phone1) linkedPhonesSet.add(e.source);
        if (e.target !== phone1) linkedPhonesSet.add(e.target);
      });
      const linkedPhones = linkedPhonesSet.size > 0 ? Array.from(linkedPhonesSet).join(", ") : "Tidak ada";

      const deviceMatch = input.deviceMatchPercent ?? 0;
      const ipCluster = input.ipCluster ?? "Unknown cluster";
      const riskScore = input.fraudRiskScore ?? Math.min(Math.round(input.ringScore), 100);

      const graphSummary = input.graphSummary ?? (input.ringDetected && input.ringEdges.length > 0
        ? `Terdapat ${input.ringEdges.length} hubungan antar nomor melalui ${[...new Set(input.ringEdges.map((e) => e.relation))].join(", ")}`
        : "Tidak ada hubungan ring yang signifikan");

      const channels = input.availableChannels?.length ? input.availableChannels.join(", ") : "BCA VA, Mandiri VA, QRIS, PayLater";

      const systemPrompt = `You are an expert fraud risk analyst and intelligent payment routing agent at Paylabs Indonesia.
Analyze this data for fraud ring signs: phone rotation, shared device/IP, mule layering, and velocity spikes.

Input:
- TX ID: ${txId} | Amount: Rp ${amountStr} | Time: ${timestamp}
- User: ${phone1} | Merchant: ${input.merchantId}
- Linked Phones: ${linkedPhones}
- Device Match: ${deviceMatch}% | IP Cluster: ${ipCluster}
- Risk Score: ${riskScore}/100 | Velocity: ${input.velocityLast60Min ?? 0} tx/hr
- Graph: ${graphSummary}
- Channels: ${channels}

Instructions:
1. Classify risk level: Low (<50), Medium (50-80), High (>80).
2. Recommend: Block All, Challenge OTP, Manual Review, or Proceed.
3. If Proceed, pick the best channel (cost-efficient & low risk).
4. Output strictly in JSON format. Explanation in Bahasa Indonesia (max 60 words).`;

      const response = await this.openai.chat.completions.create({
        model: "qwen-max",
        messages: [{ role: "system", content: systemPrompt }],
        response_format: { type: "json_object" },
        // @ts-ignore
        extra_body: { enable_thinking: true } 
      });

      return JSON.parse(response.choices[0].message.content || '{}');
    } catch (error) {
      console.error("Deep Analysis Error:", error);
      return {
        risk_level: "HIGH",
        explanation: "Sistem analisis sedang sibuk. Default ke review manual.",
        recommended_action: "MANUAL_REVIEW",
        routing_suggestion: null
      };
    }
  }

  /**
   * 2. QUICK CHECK (Low Latency)
   */
  async quickCheck(briefData: any) {
    try {
      const userPrompt = `Analisis cepat Paylabs:
      Phone: ${briefData.phone}, Amount: Rp${briefData.amount}, Geo: ${briefData.geo}, Flags: ${briefData.flags}.
      Jawab singkat: 1. Indikasi Fraud Ring? (Ya/Tidak + 1 kalimat alasan) 2. Rekomendasi (Lanjut/OTP/Block/Review).`;

      const response = await this.openai.chat.completions.create({
        model: "qwen-turbo",
        messages: [{ role: "user", content: userPrompt }],
      });
      return response.choices[0].message.content;
    } catch (error) {
      return "Proceed (AI Timeout)";
    }
  }

  /**
   * 3. AUTO-RULE GENERATION
   */
  async generateFraudRules(patterns: any, currentRules: any) {
    const systemPrompt = `You are a senior fraud rules engineer. Create 3 new IF-THEN rules based on patterns. Output: Numbered list (Bahasa) + JSON array.`;
    const response = await this.openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Patterns: ${JSON.stringify(patterns)}. Rules: ${JSON.stringify(currentRules)}` }
      ],
    });
    return response.choices[0].message.content;
  }
}

// --- Express Route Handlers ---
const aiService = new AIService();

export const deepAnalyzeHandler = async (req: Request, res: Response) => {
  const result = await aiService.deepAnalysis(req.body);
  res.json(result);
};

export const quickCheckHandler = async (req: Request, res: Response) => {
  const result = await aiService.quickCheck(req.body);
  res.send(result);
};
