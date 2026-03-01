import { DbClient, FraudRingEdge, runCypher, runCypherEdges } from "../config/db";

export interface TransactionGraphPayload {
  phone: string;
  ip: string;
  deviceFingerprint: string;
  amount: number;
  timestamp: Date;
  merchantId: string;
}

export interface FraudRingDetectionResult {
  ringDetected: boolean;
  ringScore: number;
  edges: FraudRingEdge[];
}

// Utility kecil untuk mengambil subnet IP (misal /24) sebagai cluster.
// Simple helper to derive IP subnet (e.g. /24) as cluster key.
export function getIpSubnet(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return ip;
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

// Insert / update node + edge di Apache AGE untuk transaksi.
// Insert / update graph (Phone, Device, IP_Cluster) and relationships.
export async function upsertTransactionGraph(
  client: DbClient,
  payload: TransactionGraphPayload,
): Promise<void> {
  const { phone, ip, deviceFingerprint, timestamp, merchantId } = payload;
  const ipSubnet = getIpSubnet(ip);

  // 1. Upsert Phone, Device, IP_Cluster nodes.
  const upsertCypher = `
    MATCH (p:Phone {phone: $phone})
    WITH p
    CALL {
      WITH p
      WHERE p IS NULL
      CREATE (pnew:Phone {
        phone: $phone,
        created_at: datetime(),
        first_merchant_id: $merchantId
      })
      RETURN pnew AS p2
      UNION
      WITH p
      RETURN p AS p2
    }
    WITH p2 AS p
    SET p.last_seen_at = datetime()

    MERGE (d:Device {device_id: $deviceFingerprint})
    ON CREATE SET d.created_at = datetime()
    SET d.last_seen_at = datetime()

    MERGE (ip:IP_Cluster {subnet: $ipSubnet})
    ON CREATE SET ip.created_at = datetime()
    SET ip.last_seen_at = datetime()

    MERGE (p)-[:USES_DEVICE]->(d)
    MERGE (p)-[:SAME_IP_SUBNET]->(ip);
  `;

  await runCypher(client, upsertCypher, {
    phone,
    deviceFingerprint,
    ipSubnet,
    merchantId,
  });

  // 2. Buat edge antar phone lain yang share device / ip subnet.
  const relCypher = `
    MATCH (p:Phone {phone: $phone})-[:USES_DEVICE]->(d:Device)<-[:USES_DEVICE]-(other:Phone)
    WHERE other.phone <> p.phone
    MERGE (p)-[sd:SHARED_DEVICE]->(other)
    ON CREATE SET sd.match_score = 0.95, sd.created_at = datetime()
    SET sd.updated_at = datetime()

    WITH p
    MATCH (p)-[:SAME_IP_SUBNET]->(ip:IP_Cluster)<-[:SAME_IP_SUBNET]-(other2:Phone)
    WHERE other2.phone <> p.phone
    MERGE (p)-[si:SAME_IP_SUBNET]->(other2)
    ON CREATE SET si.match_score = 0.8, si.created_at = datetime()
    SET si.updated_at = datetime();
  `;

  await runCypher(client, relCypher, {
    phone,
  });

  // 3. (Opsional) Transfer hops dapat dibangun dari histori transaksi antar phone (tidak diterapkan di MVP awal).
}

// Query 1–3 hop untuk mendeteksi fraud ring seputar phone ini.
// Detect fraud ring within 1–3 hops around a phone.
export async function detectFraudRing(
  client: DbClient,
  phone: string,
): Promise<FraudRingDetectionResult> {
  const cypher = `
    MATCH (p:Phone {phone: $phone})-[r:SHARED_DEVICE|PHONE_ROTATION|TRANSFER_HOP|SAME_IP_SUBNET*1..3]-(other:Phone)
    WITH DISTINCT p, other
    MATCH (p)-[r2:SHARED_DEVICE|PHONE_ROTATION|TRANSFER_HOP|SAME_IP_SUBNET]-(other)
    RETURN DISTINCT
      p.phone AS source,
      other.phone AS target,
      type(r2) AS relation,
      coalesce(r2.match_score, 1.0) AS score;
  `;

  const edges = await runCypherEdges(client, cypher, { phone });

  const ringDetected = edges.length > 0;

  // Skor sederhana: jumlah edge * skor rata-rata.
  const avgScore =
    edges.length === 0
      ? 0
      : edges.reduce((sum, e) => sum + (e.score ?? 1), 0) / edges.length;
  const ringScore = edges.length * avgScore;

  return {
    ringDetected,
    ringScore,
    edges,
  };
}

