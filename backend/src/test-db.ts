import { pool } from "./config/db"

async function testConnection() {
  try {
    console.log('⏳ Sedang mencoba terhubung ke PolarDB...');
    await pool.connect();
    console.log('✅ KONEKSI BERHASIL!');

    // Coba eksekusi query sederhana
    const res = await pool.query('SELECT NOW() as "Waktu Database"');
    console.log('🕒 Respon Server:', res.rows[0]);

    await pool.end();
  } catch (err:any) {
    console.error('❌ KONEKSI GAGAL!');
    console.error('Alasan:', err.message);
  }
}

testConnection();