import { Router, Request, Response, NextFunction } from "express";
import { withTransaction, query } from "../config/db";
import {
  detectFraudRing,
  upsertTransactionGraph,
} from "../services/graphService";
import {
  getFraudDecisionFromQwen,
  QwenFraudDecision,
} from "../services/qwenService";
import {
  sendToPaylabsSandbox,
  PaylabsResponse,
} from "../services/paylabsService";

const router = Router();

export interface TransactionRequestBody {
  phone: string;
  ip: string;
  device_fingerprint: string;
  timestamp: string;
  amount: number;
  merchantId?: string;
  externalId?: string;
}

// POST /api/transaction
// Endpoint utama yang dipanggil merchant test.
router.post(
  "/",
  async (req: Request<unknown, unknown, TransactionRequestBody>, res: Response, next: NextFunction) => {
    try {
      const {
        phone,
        ip,
        device_fingerprint,
        timestamp,
        amount,
        merchantId,
        externalId,
      } = req.body;

      if (!phone || !ip || !device_fingerprint || !timestamp || !amount) {
        return res.status(400).json({
          error:
            "Missing required fields: phone, ip, device_fingerprint, timestamp, amount.",
        });
      }

      const merchant =
        merchantId || process.env.DEFAULT_MERCHANT_ID || "010639";
      const txTimestamp = new Date(timestamp);
      const extId =
        externalId ||
        `TX-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

      // Jalankan seluruh flow dalam transaksi database.
      const result = await withTransaction(async (client) => {
        // 1. Insert / update graph di Apache AGE.
        await upsertTransactionGraph(client, {
          phone,
          ip,
          deviceFingerprint: device_fingerprint,
          amount,
          timestamp: txTimestamp,
          merchantId: merchant,
        });

        // 2. Query Cypher untuk deteksi fraud ring.
        const ringResult = await detectFraudRing(client, phone);

        // 3. Panggil Qwen untuk explainable decision.
        const qwenDecision: QwenFraudDecision =
          await getFraudDecisionFromQwen({
            phone,
            ip,
            deviceFingerprint: device_fingerprint,
            amount,
            merchantId: merchant,
            ringDetected: ringResult.ringDetected,
            ringScore: ringResult.ringScore,
            ringEdges: ringResult.edges,
          });

        // 4. Intelligent routing channel berdasarkan rekomendasi Qwen.
        const routingChannel = qwenDecision.routing_suggestion;

        // 5. Jika aman, kirim ke Paylabs; jika tidak, hanya log.
        let paylabsResp: PaylabsResponse | null = null;
        let status = "PENDING";

        if (qwenDecision.recommended_action === "BLOCK_ALL") {
          status = "BLOCKED";
        } else if (qwenDecision.recommended_action === "CHALLENGE_OTP") {
          status = "CHALLENGE_OTP";
        } else {
          // PROCEED / MANUAL_REVIEW → kirim ke Paylabs sandbox (atau tetap log).
          paylabsResp = await sendToPaylabsSandbox({
            mid: merchant,
            channel: routingChannel,
            amount,
            phone,
            externalId: extId,
          });
          status = paylabsResp.success ? "ROUTED" : "ROUTING_FAILED";
        }

        // 6. Simpan transaksi ke tabel transactions.
        const txInsert = await client.query(
          `
          INSERT INTO transactions (
            external_id,
            phone,
            ip,
            device_fingerprint,
            event_timestamp,
            amount,
            merchant_id,
            risk_level,
            recommended_action,
            routing_channel,
            status,
            qwen_response,
            paylabs_response
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
          RETURNING id;
        `,
          [
            extId,
            phone,
            ip,
            device_fingerprint,
            txTimestamp,
            amount,
            merchant,
            qwenDecision.risk_level,
            qwenDecision.recommended_action,
            routingChannel,
            status,
            qwenDecision,
            paylabsResp,
          ],
        );

        const transactionId = txInsert.rows[0].id as number;

        // 7. Simpan log fraud ring.
        await client.query(
          `
          INSERT INTO fraud_ring_logs (
            transaction_id,
            phone,
            ring_detected,
            ring_score,
            ring_edges
          ) VALUES ($1, $2, $3, $4, $5);
        `,
          [
            transactionId,
            phone,
            ringResult.ringDetected,
            ringResult.ringScore,
            JSON.stringify(ringResult.edges),
          ],
        );

        return {
          transactionId,
          ringResult,
          qwenDecision,
          routingChannel,
          status,
          paylabs: paylabsResp,
        };
      });

      return res.status(201).json({
        message: "Transaction processed by Paylabs RingShield.",
        transaction_id: result.transactionId,
        status: result.status,
        routing_channel: result.routingChannel,
        qwen_decision: result.qwenDecision,
        ring: result.ringResult,
        paylabs: result.paylabs,
      });
    } catch (err) {
      next(err);
    }
  },
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

