import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
import { Pool, PoolClient, QueryResult } from "pg";

export const pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432", 10),
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      ssl:
        process.env.DB_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
});

async function testConnection() {
  try {
    console.log('⏳ Sedang mencoba terhubung ke PolarDB...');
    await pool.connect();
    console.log('✅ KONEKSI BERHASIL!');

    // Coba eksekusi query sederhana
    const res = await pool.query('SELECT NOW() as "Waktu Database"');
    console.log('🕒 Respon Server:', res.rows[0]);

    await pool.end();
  } catch (err: any) {
    console.error('❌ KONEKSI GAGAL!');
    // Cetak seluruh objek error agar kita tahu isinya apa
    console.log('--- Detail Error Lengkap ---');
    console.dir(err); 
    console.log('---------------------------');
    
    if (err.code) console.error('Kode Error:', err.code);
    if (err.stack) console.error('Stack Trace:', err.stack);
  }
}

testConnection();

export type DbClient = PoolClient;

export interface FraudRingEdge {
  source: string;
  target: string;
  relation: string;
  score: number | null;
}

const AGE_GRAPH_NAME = process.env.AGE_GRAPH_NAME || "fraud_ring_graph";

// Helper umum untuk query SQL biasa.
export async function query<T extends QueryResult= any>(
  text: string,
  params: any[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

// Helper untuk menjalankan blok dalam transaksi.
export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SET search_path = ag_catalog, "$user", public');
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

// Menjamin search_path AGE aktif sebelum memanggil cypher.
async function ensureAgeSearchPath(client: DbClient): Promise<void> {
  await client.query('SET search_path = ag_catalog, "$user", public');
}

// Helper untuk menjalankan Cypher (Apache AGE).
export async function runCypher(
  client: DbClient,
  cypherQuery: string,
  params: Record<string, any> = {},
): Promise<any[]> {
  await ensureAgeSearchPath(client);
  const sql = `SELECT * FROM cypher($1, $2, $3) AS (result agtype)`;
  const result = await client.query(sql, [
    AGE_GRAPH_NAME,
    cypherQuery,
    JSON.stringify(params),
  ]);
  return result.rows.map((row) => row.result);
}

// Helper Cypher khusus untuk mengembalikan edge yang mudah dibaca frontend.
export async function runCypherEdges(
  client: DbClient,
  cypherQuery: string,
  params: Record<string, any> = {},
): Promise<FraudRingEdge[]> {
  await ensureAgeSearchPath(client);
  const sql = `SELECT * FROM cypher($1, $2, $3) AS (source varchar, target varchar, relation varchar, score float8)`;
  const result = await client.query<FraudRingEdge>(sql, [
    AGE_GRAPH_NAME,
    cypherQuery,
    JSON.stringify(params),
  ]);
  return result.rows;
}

// Inisialisasi schema dasar (tabel + AGE graph).
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS age");
      await ensureAgeSearchPath(client);

      // DO block tidak bisa pakai parameter $1, jadi gunakan literal graph name.
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${AGE_GRAPH_NAME}'
          ) THEN
            PERFORM create_graph('${AGE_GRAPH_NAME}');
          END IF;
        END
        $$;
      `);
    } catch (err) {
      console.warn(
        "[WARN] AGE initialization failed. Pastikan extension AGE sudah terpasang dan user punya izin yang cukup:",
        (err as Error).message,
      );
    }

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

    console.log("[INFO] Database & graph schema initialized.");
  } catch (error) {
    console.error("[ERROR] Database initialization failed:", error);
    throw error;
  } finally {
    client.release();
  }
}