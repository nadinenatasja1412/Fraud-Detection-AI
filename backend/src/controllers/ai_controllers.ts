import { Request, Response } from 'express';
import { AIService, QwenFraudDecisionInput} from '../services/ai.service';
import { sendToPaylabsSandbox, PaylabsRequestPayload } from '../services/paylabsService';

// Instansiasi class service
const aiService = new AIService();

export const processPayment = async (req: Request, res: Response) => {
  try {
    // 1. Map req.body ke interface QwenFraudDecisionInput
    // Pastikan data graph/ring dari database/fraud engine internal sudah masuk di sini
    const txData: QwenFraudDecisionInput = req.body;

    // 2. Jalankan AI Fraud Analysis (Deep Analysis)
    const fraudAnalysis = await aiService.deepAnalysis(txData);

    // 3. Logika Decision Making Berdasarkan Risk Level & Action
    // Kita cek 'recommended_action' karena lebih spesifik daripada sekadar risk_level
    if (fraudAnalysis.recommended_action === "BLOCK_ALL") {
      return res.status(403).json({
        status: "blocked",
        fraud_analysis: fraudAnalysis,
        message: "Transaksi diblokir oleh RingShield AI."
      });
    }

    if (fraudAnalysis.recommended_action === "CHALLENGE_OTP") {
      return res.status(200).json({
        status: "challenge_required",
        fraud_analysis: fraudAnalysis,
        message: "Verifikasi tambahan (OTP) diperlukan."
      });
    }

    // 4. Implementasi SMART ROUTING
    // Gunakan channel rekomendasi AI jika ada, jika tidak gunakan channel default dari user
    const finalChannel = fraudAnalysis.routing_suggestion || txData.availableChannels?.[0] || "QRIS";

    const paylabsPayload: PaylabsRequestPayload = {
      mid: process.env.PAYLABS_MID || "010639",
      channel: finalChannel, 
      amount: txData.amount,
      phone: txData.phone,
      externalId: txData.transactionId || `TX-${Date.now()}`,
      description: `Verified by AI: ${fraudAnalysis.risk_level} Risk`
    };

    // 5. Eksekusi ke Paylabs
    const paylabsRes = await sendToPaylabsSandbox(paylabsPayload);

    if (paylabsRes.success) {
      return res.json({
        status: "success",
        routing_used: finalChannel,
        fraud_analysis: fraudAnalysis,
        paylabs_response: paylabsRes.raw
      });
    } else {
      return res.status(400).json({
        status: "payment_failed",
        fraud_analysis: fraudAnalysis,
        error_details: paylabsRes.raw
      });
    }

  } catch (error: any) {
    console.error("Controller Error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error during payment processing"
    });
  }
};

export const deepAnalyzeHandler = async (req: Request, res: Response) => {
  try {
    // Ambil data dari body request
    const txData = req.body;

    // Panggil service
    const analysis = await aiService.deepAnalysis(txData);
    
    // Kirim response
    res.status(200).json({
      status: "success",
      data: analysis
    });
  } catch (error: any) {
    console.error("Controller Error:", error.message);
    res.status(500).json({ 
      status: "error",
      message: error.message 
    });
  }
};

export const quickCheckHandler = async (req: Request, res: Response) => {
  try {
    const result = await aiService.quickCheck(req.body);
    res.status(200).json({
      status: "success",
      result: result
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};