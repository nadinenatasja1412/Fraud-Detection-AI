import dotenv from "dotenv";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg"; // Tambahkan QueryResultRow
dotenv.config();

// Konfigurasi Pool
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  // Pastikan SSL dikonfigurasi dengan benar untuk Cloud DB (PolarDB)
  ssl: process.env.DB_SSL === 'true' 
  ? { rejectUnauthorized: false } 
  : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export type DbClient = PoolClient;

export interface FraudRingEdge {
  source: string;
  target: string;
  relation: string;
  score: number | null;
}

const AGE_GRAPH_NAME = process.env.AGE_GRAPH_NAME || "fraud_ring_graph";

//
export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = [], // Gunakan default array kosong untuk menghindari error undefined
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}
// Helper untuk menjalankan blok dalam transaksi.
export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * PERBAIKAN: runCypher
 * Apache AGE memerlukan pemanggilan 'ag_catalog.cypher' secara eksplisit 
 * jika search_path belum disetel secara global di level database.
 */
export async function runCypher(
  client: DbClient,
  cypherQuery: string,
  params: Record<string, any> = {},
): Promise<any[]> {
  // Kita bungkus params ke dalam JSON string karena AGE menerima argumen ke-3 sebagai json
  const sql = `SELECT * FROM cypher($1, $2, $3) AS (result agtype)`;
  const result = await client.query(sql, [
    AGE_GRAPH_NAME,
    cypherQuery,
    JSON.stringify(params),
  ]);
  return result.rows.map(row => row.result);
}

/**
 * PERBAIKAN: runCypherEdges
 * Pemetaan kolom di 'AS (...)' harus sesuai dengan RETURN pada query Cypher Anda.
 */
export async function runCypherEdges(
  client: DbClient,
  cypherQuery: string,
  params: Record<string, any> = {},
): Promise<FraudRingEdge[]> {
  // Catatan: Pastikan query Cypher Anda me-return 4 nilai: source, target, relation, score
  const sql = `SELECT * FROM cypher($1, $2, $3) AS (source varchar, target varchar, relation varchar, score float8)`;
  const result = await client.query<FraudRingEdge>(sql, [
    AGE_GRAPH_NAME,
    cypherQuery,
    JSON.stringify(params),
  ]);
  return result.rows;
}

// Inisialisasi schema dasar
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Setup Apache AGE
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS age");
      // PERBAIKAN: Load PATH agar fungsi 'cypher' dikenali
      await client.query(`SET search_path = ag_catalog, "$user", public`);
      
      /** * PERBAIKAN: Blok DO tidak mendukung parameter $1 secara langsung. 
       * Kita gunakan string template (aman karena ini konstanta internal) 
       * atau menggunakan format() jika variabel dinamis.
       */
      await client.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${AGE_GRAPH_NAME}') THEN
                PERFORM create_graph('${AGE_GRAPH_NAME}');
            END IF;
        END $$;
      `);
    } catch (err) {
      console.warn(
        "[WARN] AGE initialization failed. Periksa apakah user memiliki akses superuser atau extension sudah terpasang:",
        (err as Error).message,
      );
    }

    // 2. Tabel transaksi utama
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id BIGSERIAL PRIMARY KEY,
        external_id VARCHAR(64),
        phone VARCHAR(64),
        ip VARCHAR(64),
        device_fingerprint VARCHAR(255),
        event_timestamp TIMESTAMPTZ,
        amount NUMERIC(18,2),
        merchant_id VARCHAR(64),
        risk_level VARCHAR(32),
        recommended_action VARCHAR(32),
        routing_channel VARCHAR(32),
        status VARCHAR(32),
        qwen_response JSONB,
        paylabs_response JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Log fraud ring
    await client.query(`
      CREATE TABLE IF NOT EXISTS fraud_ring_logs (
        id BIGSERIAL PRIMARY KEY,
        transaction_id BIGINT REFERENCES transactions(id) ON DELETE CASCADE,
        phone VARCHAR(64),
        ring_detected BOOLEAN,
        ring_score NUMERIC,
        ring_edges JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log("[INFO] Database & Graph Schema initialized successfully.");
  } catch (error) {
    console.error("[ERROR] Database initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}