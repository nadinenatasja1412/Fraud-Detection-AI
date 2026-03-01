import { AIService, QwenFraudDecisionInput } from "./src/services/ai.service"; // Pastikan path benar
import * as dotenv from "dotenv";

dotenv.config();

// Inisialisasi Service
const aiService = new AIService();

async function runTest() {
  console.log("--- Memulai Test Fraud Detection (Paylabs RingShield) ---");

  // Simulasi data transaksi yang mencurigakan (Fraud Ring)
  const mockInput: QwenFraudDecisionInput = {
    transactionId: "TX-999001",
    phone: "08123456789",
    ip: "103.10.11.12",
    deviceFingerprint: "device-abc-123",
    amount: 5000000,
    merchantId: "MERCH-001",
    ringDetected: true,
    ringScore: 85,
    ringEdges: [
      { source: "08123456789", target: "0811111111", relation: "SAME_DEVICE", score: 0.9 },
      { source: "0811111111", target: "0822222222", relation: "SAME_IP", score: 0.8 }
    ],
    deviceMatchPercent: 90,
    ipCluster: "Jakarta Selatan Subnet A",
    fraudRiskScore: 88,
    velocityLast60Min: 12, // Tinggi
    availableChannels: ["VA_BCA", "VA_MANDIRI", "QRIS"]
  };

  try {
    // PERBAIKAN: Panggil method deepAnalysis dari instance aiService
    const result = await aiService.deepAnalysis(mockInput);
    
    console.log("\n--- HASIL ANALISIS AI ---");
    console.log(`Risk Level: ${result.risk_level}`);
    console.log(`Action    : ${result.recommended_action}`);
    console.log(`Channel   : ${result.routing_suggestion || 'N/A'}`);
    console.log(`Explanation: ${result.explanation}`);
    
    console.log("\n--- TABEL RESPONSE ---");
    console.table(result); 
    
    if (result.risk_level === "HIGH" || result.risk_level === "CRITICAL") {
        console.log("\n⚠️  DETEKSI FRAUD: Transaksi ini otomatis diblokir atau butuh review!");
    } else {
        console.log("\n✅ Transaksi aman untuk diproses ke Paylabs.");
    }

  } catch (error) {
    console.error("❌ Test Gagal:", error);
  }
}

runTest();