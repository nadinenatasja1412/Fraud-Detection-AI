import { Router, Request, Response, NextFunction } from "express";
import { withTransaction, query } from "../config/db";
import { detectFraudRing, upsertTransactionGraph } from "../services/graphService";
// Update import ke AIService
import { AIService, QwenFraudDecisionInput } from "../services/ai.service";
import { sendToPaylabsSandbox, PaylabsResponse } from "../services/paylabsService";

const router = Router();
const aiService = new AIService(); // Inisialisasi class

export interface TransactionRequestBody {
  phone: string;
  ip: string;
  device_fingerprint: string;
  timestamp: string;
  amount: number;
  merchantId?: string;
  externalId?: string;
}

router.post(
  "/",
  async (req: Request<unknown, unknown, TransactionRequestBody>, res: Response, next: NextFunction) => {
    try {
      const { phone, ip, device_fingerprint, timestamp, amount, merchantId, externalId } = req.body;

      // ... (Validation logic tetap sama) ...

      const merchant = merchantId || process.env.DEFAULT_MERCHANT_ID || "010639";
      const txTimestamp = new Date(timestamp);
      const extId = externalId || `TX-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

      const result = await withTransaction(async (client) => {
        // 1. Insert ke Apache AGE
        await upsertTransactionGraph(client, {
          phone,
          ip,
          deviceFingerprint: device_fingerprint,
          amount,
          timestamp: txTimestamp,
          merchantId: merchant,
        });

        // 2. Deteksi Fraud Ring
        const ringResult = await detectFraudRing(client, phone);

        // 3. PERBAIKAN: Panggil method deepAnalysis dari AIService
        // Pastikan mapping field sesuai dengan interface QwenFraudDecisionInput
        const qwenDecision = await aiService.deepAnalysis({
          phone,
          ip,
          deviceFingerprint: device_fingerprint,
          amount,
          merchantId: merchant,
          timestamp: timestamp,
          ringDetected: ringResult.ringDetected,
          ringScore: ringResult.ringScore,
          ringEdges: ringResult.edges, // Pastikan graphService mengembalikan field 'edges'
          // Opsional: tambahkan data tambahan jika ada
          velocityLast60Min: 0, 
          availableChannels: ["VA_BCA", "VA_MANDIRI", "QRIS"] 
        });

        // 4. Intelligent routing berdasarkan rekomendasi Qwen
        // Berikan fallback jika routing_suggestion null
        const routingChannel = qwenDecision.routing_suggestion || "QRIS";

        // 5. Decision Engine Logic
        let paylabsResp: PaylabsResponse | null = null;
        let status = "PENDING";

        // Gunakan enum string sesuai dengan AIService
        if (qwenDecision.recommended_action === "BLOCK_ALL") {
          status = "BLOCKED";
        } else if (qwenDecision.recommended_action === "CHALLENGE_OTP") {
          status = "CHALLENGE_OTP";
        } else {
          // PROCEED atau MANUAL_REVIEW tetap kirim ke sandbox Paylabs
          paylabsResp = await sendToPaylabsSandbox({
            mid: merchant,
            channel: routingChannel as any,
            amount,
            phone,
            externalId: extId,
          });
          status = paylabsResp.success ? "ROUTED" : "ROUTING_FAILED";
        }

        // 6. Simpan ke database (Gunakan qwenDecision langsung sebagai JSON)
        const txInsert = await client.query(
          `INSERT INTO transactions (...) VALUES (...) RETURNING id;`,
          [
            extId, phone, ip, device_fingerprint, txTimestamp, amount, merchant,
            qwenDecision.risk_level, qwenDecision.recommended_action, 
            routingChannel, status, JSON.stringify(qwenDecision), JSON.stringify(paylabsResp)
          ]
        );

        const transactionId = txInsert.rows[0].id;

        // 7. Log Fraud Ring
        await client.query(
          `INSERT INTO fraud_ring_logs (...) VALUES ($1, $2, $3, $4, $5);`,
          [transactionId, phone, ringResult.ringDetected, ringResult.ringScore, JSON.stringify(ringResult.edges)]
        );

        return { transactionId, ringResult, qwenDecision, routingChannel, status, paylabs: paylabsResp };
      });

      return res.status(201).json({
        message: "Transaction processed by Paylabs RingShield.",
        ...result
      });
    } catch (err) {
      next(err);
    }
  }
);

// Endpoint helper untuk dashboard: mengambil alert terbaru.
router.get(
  "/alerts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Number(req.query.limit) || 20;
      const result = await query(
        `
        SELECT
          l.id,
          t.external_id,
          t.phone,
          t.amount,
          t.merchant_id,
          t.risk_level,
          t.recommended_action,
          t.routing_channel,
          t.status,
          l.ring_score,
          l.ring_edges,
          t.qwen_response,
          t.created_at
        FROM fraud_ring_logs l
        JOIN transactions t ON t.id = l.transaction_id
        ORDER BY l.created_at DESC
        LIMIT $1;
      `,
        [limit],
      );

      return res.json({
        alerts: result.rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

