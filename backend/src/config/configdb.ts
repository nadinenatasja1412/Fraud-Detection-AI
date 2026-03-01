import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, 
  max: 20, 
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export default pool;

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
    console.log("Cek Host dari ENV:", process.env.DB_HOST);
    // Cetak seluruh objek error agar kita tahu isinya apa
    console.log('--- Detail Error Lengkap ---');
    console.dir(err); 
    console.log('---------------------------');
    
    if (err.code) console.error('Kode Error:', err.code);
    if (err.stack) console.error('Stack Trace:', err.stack);
  }
}

testConnection();