import { getFraudDecisionFromQwen, QwenFraudDecisionInput } from "./src/services/qwenService";
import * as dotenv from "dotenv";

dotenv.config();

async function runTest() {
  console.log("--- Memulai Test Fraud Detection ---");

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
    const result = await getFraudDecisionFromQwen(mockInput);
    
    console.log("--- HASIL DARI QWEN ---");
    console.table(result); // Menampilkan hasil dalam bentuk tabel di console
    
    if (result.risk_level === "HIGH" || result.risk_level === "CRITICAL") {
        console.log("⚠️ Peringatan: Transaksi ini berisiko tinggi!");
    }
  } catch (error) {
    console.error("Test Gagal:", error);
  }
}

runTest();