# Deploy ke Vercel

Proyek ini memakai **Vite + Vercel Functions**, **Turso/libSQL** untuk database,
dan **public Vercel Blob** untuk JPEG serta thumbnail. Tidak ada data acara yang
ditulis ke disk Vercel. Mode SQLite + folder lokal tetap tersedia untuk development.

## 1. Siapkan database Turso

1. Buat database **libSQL/SQLite** di [Turso](https://turso.tech/). Adapter memakai
   `@libsql/client`, bukan driver untuk engine Turso baru. Pilih lokasi dekat
   region Vercel Function untuk menjaga transaksi tetap singkat. Runtime memeriksa
   bahwa database mengaktifkan foreign keys secara default untuk menjaga relasi data.
2. Salin database URL (`libsql://…turso.io`) dan database auth token dengan izin
   tulis. Simpan di `.env` lokal yang sudah diabaikan Git:

   ```dotenv
   TURSO_DATABASE_URL=libsql://nama-database-organisasi.turso.io
   TURSO_AUTH_TOKEN=isi-token-database
   ```

3. Jalankan dari root proyek:

   ```powershell
   npm ci
   npm run db:init
   npm run admin:create
   ```

   `db:init` membuat tabel/index, menambahkan kolom pesan pada database lama, dan
   mempertahankan data. **Untuk pembaruan fitur pesan, jalankan `npm run db:init`
   pada database Turso sebelum redeploy.** Jalankan
   lagi sebelum deploy versi yang menambah schema; **build dan cold start tidak
   menjalankan migration**. CLI admin meminta email dan password minimal 12
   karakter. Jika tabel belum tersedia, jalankan `db:init` terlebih dahulu.
   Untuk deployment baru jangan mengisi credential admin ke Vercel: admin sudah
   tersimpan di Turso melalui CLI ini. `.env` lokal harus menunjuk database yang
   sama dengan environment deployment yang ingin disiapkan.

## 2. Siapkan Vercel Blob

1. Buat/import proyek di Vercel, lalu buka **Storage → Create Database → Blob**.
2. Pilih akses **Public**, hubungkan store ke proyek, dan pastikan environment
   `BLOB_READ_WRITE_TOKEN` tersedia untuk deployment yang dipilih.
3. Tambahkan `STORAGE_PROVIDER=vercel-blob`.

Foto acara memang ditampilkan di galeri publik. Blob memakai nama UUID acak dan
dapat dibaca siapa pun yang memiliki URL foto. Secret database dan Blob hanya
dipakai server; jangan menambahkan prefix `VITE_` pada secret.

## 3. Atur proyek Vercel

Upload source melalui Git repository, lalu import repository di Vercel. Root
directory adalah folder yang berisi `package.json` dan `vercel.json`.

| Pengaturan | Nilai |
| --- | --- |
| Framework preset | Vite |
| Node.js | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

Konfigurasi routing ada di `vercel.json`: `/api/*` dan `/media/*` ke satu Function;
halaman `/admin`, `/camera/:code`, dan `/gallery` ke SPA. Aset build disajikan CDN.
Jangan memakai `npm start` sebagai build command.

Tambahkan environment berikut pada **Settings → Environment Variables**:

| Variable | Isi |
| --- | --- |
| `TURSO_DATABASE_URL` | URL database libSQL |
| `TURSO_AUTH_TOKEN` | Token database dengan izin tulis |
| `STORAGE_PROVIDER` | `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | Token public Blob store yang terhubung |
| `PUBLIC_URL` | Origin final, misalnya `https://weddingcam.vercel.app` |

`PUBLIC_URL` harus sama persis dengan domain yang dibuka pengguna. Tidak boleh
berisi path atau trailing query. Arahkan alias/domain lain ke domain utama agar
cookie, CSRF, dan QR konsisten. Jika `PUBLIC_URL` belum diisi, aplikasi memakai
`https://VERCEL_URL` dari Vercel; sebelum mencetak QR, isi domain produksi yang
stabil dan redeploy. `HOST`, `PORT`, `DATA_DIR`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
dan `TRUST_PROXY` tidak perlu diisi di Vercel.

Gunakan database dan Blob store terpisah untuk **Preview** dan **Production**.
Jangan menyalin `PUBLIC_URL` produksi ke Preview; kosongkan agar memakai
`VERCEL_URL`, atau isi origin preview yang tepat. Siapkan schema dan admin pada
masing-masing database. Pilih region Function dekat database melalui pengaturan
Vercel. Periksa kuota storage/transfer paket layanan sebelum acara.

## 4. Deploy dan periksa

1. Deploy setelah environment terisi. Perubahan environment memerlukan redeploy.
2. Buka `/api/health`; hasil harus `{"ok":true}`. Jika 503, pastikan database dapat
   diakses, `db:init` sudah dijalankan, dan semua variable wajib terisi.
3. Buka `/admin`, login menggunakan akun dari CLI, ubah detail acara, dan buat QR.
4. Pindai QR di ponsel HTTPS, ambil/unggah foto, lalu periksa galeri, thumbnail,
   unduh, kuota, dan penghapusan. Refresh langsung halaman admin/kamera juga harus
   bekerja. Uji kamera di Safari iOS/Chrome Android sebelum acara.
5. Redeploy sekali dan pastikan pengaturan serta foto sebelumnya tetap ada.

Foto sumber boleh sampai 12 MB. Browser mengompres gambar di atas 3 MiB sebelum
mengirim; backend Vercel membatasi file multipart sampai 4 MiB agar keseluruhan
request berada di bawah batas 4,5 MB. Backend tetap memvalidasi isi gambar dan
membuang EXIF. Pengurangan ukuran ini dapat menurunkan resolusi/kualitas foto.
Tamu dapat menambahkan pesan opsional maksimal 500 karakter sebelum menyimpan.
Pesan disimpan dalam transaksi yang sama dengan foto, ditampilkan di bawah foto,
dan ikut dibaca oleh galeri publik serta pratinjau admin. Foto lama tanpa pesan
tetap tampil seperti biasa.

## Data lama, backup, dan kegagalan

Jika frontend terbuka tetapi muncul pesan server belum siap, cek URL
`/api/health` dan **Vercel → Logs**. Pada versi terbaru, respons/log memberikan
kode berikut tanpa membocorkan token:

Untuk memeriksa database secara lokal, isi `TURSO_DATABASE_URL` dan
`TURSO_AUTH_TOKEN` di `.env` dengan konfigurasi database deployment yang sama,
lalu jalankan `npm run db:check`. Perintah ini hanya membaca koneksi/schema;
tidak membuat tabel dan tidak mengubah foto/pengaturan. Output tidak berisi token.
Jika muncul `DATABASE_SCHEMA_NOT_READY`, jalankan `npm run db:init`, lalu
`npm run db:check` lagi. Setelah hasil `DATABASE_READY`, redeploy kode terbaru.
Pesan log lama `SQLITE_UNKNOWN` saja belum menjelaskan query yang gagal; tabel
belum dibuat atau kolom `message` belum ditambahkan adalah kemungkinan yang
perlu diperiksa, bukan bukti token salah.

| Kode | Langkah perbaikan |
| --- | --- |
| `CONFIG_MISSING_ENV` | Isi variabel yang disebutkan pada environment deployment yang dibuka, lalu redeploy. Production dan Preview memiliki konfigurasi terpisah. |
| `CONFIG_INVALID_STORAGE_PROVIDER` | Isi value `vercel-blob`, tanpa tanda kutip pembungkus, lalu redeploy. |
| `CONFIG_INVALID_PUBLIC_URL` | Isi origin HTTPS website, tanpa path/query. |
| `CONFIG_INVALID_DATABASE` | Pakai URL database `libsql://...` atau `https://...` dan auth token Turso. |
| `DATABASE_SCHEMA_NOT_READY` | Jalankan `npm run db:init` dengan `.env` menunjuk database Turso yang sama; lalu redeploy. Environment variables saja tidak membuat tabel. |
| `DATABASE_AUTH_FAILED` | Periksa kecocokan URL/token database dan masa berlaku token, simpan perubahan, lalu redeploy. |
| `DATABASE_CONNECTION_FAILED` | Periksa URL, token, status database, dan jaringan; lihat provider code pada Runtime Logs. |
| `DATABASE_FOREIGN_KEYS_DISABLED` | Gunakan database libSQL yang mengaktifkan foreign keys secara default. |
| `STORAGE_INITIALIZATION_FAILED` | Periksa provider/token Blob dan dependency pada deployment terbaru. |

Variabel yang baru disimpan tidak mengubah deployment lama. Setelah redeploy,
buka domain produksi yang menunjuk deployment terbaru. Label “Needs Attention”
di dashboard saja tidak cukup untuk memastikan penyebab startup gagal; baca
detail peringatannya dan cocokkan dengan Runtime Logs.

- `data/wedding.sqlite` dan `data/photos/` lama **tidak otomatis diunggah**. Mode
  cloud yang baru dimulai kosong kecuali database diimpor. Untuk membawa acara
  lama, hentikan penulisan, backup seluruh `data/`, impor SQLite ke Turso, unggah
  kedua file setiap foto ke Blob, lalu ubah `photos.storage_name` dan `thumb_name`
  menjadi URL Blob hasil upload sebelum memakai mode cloud. Mengimpor SQLite
  saja tidak memindahkan file foto. Folder lokal asli tidak diubah oleh perubahan ini.
- Backup database Turso dan file Blob secara terpisah. Backup database saja tidak
  mencakup foto; uji pemulihan keduanya. Simpan token di pengelola secret.
- Kuota, reservasi sesi, dan idempotency memakai transaksi tulis di database
  bersama. Rate limit cloud juga disimpan di database agar berlaku lintas Function.
  Jalankan `db:init` berkala untuk membersihkan penghitung rate limit kedaluwarsa.
- Jika respons COMMIT hilang, API mempertahankan objek yang mungkin sudah
  direferensikan database. Coba Save lagi dengan idempotency key yang sama;
  aplikasi akan membaca hasil sebelumnya tanpa memakai kuota lagi.
- File baru dibersihkan ketika upload gagal. Penghentian Function secara paksa
  atau COMMIT yang hasilnya tidak diketahui dapat meninggalkan Blob tanpa
  referensi. Rekonsiliasi berkala harus membandingkan URL dengan seluruh record
  foto; jangan menghapus objek yang masih direferensikan. Tidak ada penghapusan
  otomatis Blob saat cold start.
- Penghapusan foto menandai tombstone sebelum menghapus objek. Jika Blob sedang
  gagal, API mengembalikan error dan endpoint DELETE yang sama dapat diulang.
  URL CDN langsung dapat tersimpan di cache setidaknya 60 detik. Kuota tidak
  dikembalikan setelah penghapusan.

## Verifikasi kode

```powershell
npm run check
```

Suite API dijalankan dengan SQLite lokal dan sekali lagi dengan client libSQL
asinkron pada fixture disposable. Test cloud memakai fake Blob SDK untuk
memastikan rollback, cleanup, redirect media, download, serta retry penghapusan.
Test tersebut tidak membuktikan credential/kuota cloud atau konfigurasi akun
Vercel; lakukan smoke test langkah 4 pada deployment sebenarnya.

Referensi resmi:
[Vercel SQLite](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel),
[Function limits](https://vercel.com/docs/functions/limitations),
[Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[Turso SDK](https://docs.turso.tech/sdk/ts/reference).
