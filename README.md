# Vows & Views

Wedding photo booth dan online gallery dengan backend, database persisten, dan
dashboard admin. Frontend React + TypeScript; backend Express. Mode lokal memakai
SQLite WAL dan filesystem privat; mode Vercel memakai Turso/libSQL serta public
Vercel Blob. Panduan upload/deploy: **[docs/VERCEL.md](docs/VERCEL.md)**.
Arsitektur dan aturan kuota:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mulai secara lokal

Prasyarat: Node.js 22.13+ (22.x, atau 24+), npm. Node 22 mengeluarkan peringatan
experimental untuk `node:sqlite`; hal ini normal. Paket sudah dikunci melalui
`package-lock.json`.

```powershell
npm ci
npm run admin:create
npm run dev
```

CLI meminta email serta password minimal 12 karakter (input password disembunyikan).
Tidak ada password admin bawaan. CLI dapat dipakai lagi untuk membuat admin lain.
Buka **http://localhost:5173**, admin **http://localhost:5173/admin**. Gunakan hostname
ini secara konsisten karena cookie dan pemeriksaan Origin terikat pada origin.
Data aplikasi otomatis dibuat di `data/` dan tidak masuk source control.

Konfigurasi opsional: salin `.env.example` menjadi `.env`. `ADMIN_EMAIL` dan
`ADMIN_PASSWORD` hanya membuat akun pertama bila tabel admin masih kosong; hapus
kedua nilai setelah provisioning. Mengubahnya tidak mengganti password akun lama.
`PORT` untuk pengembangan tetap 3001 (sesuai proxy di vite.config.ts).

## Alur penggunaan

1. Masuk melalui `/admin` dengan username atau email. Admin Utama membuat akun studio
   di **User Management** dan menetapkan pemilik di **Project Management**.
   Admin Project juga dapat membuat project sendiri di **My Projects**.
   Di **Landing Page Settings**, pilih project untuk mengedit teks, tema, logo,
   cover, banner, background, dan dekorasi. Pilih crop, periksa pratinjau, lalu simpan.
   **Camera Filter Settings** mengatur pilihan filter untuk project tersebut.
2. Pada **QR codes**, pilih project, label, dan kode URL. Tautan berbentuk
   `/nama-user/kode-qr`. Kode akses bersifat unik di seluruh aplikasi agar dapat
   dimasukkan tanpa username. Admin Utama memberikan kuota akun melalui **User Management**.
   Studio memilih sendiri alokasi QR dan batas per sesi, dengan nilai awal dari **System Settings**.
   QR yang dibuat Admin Utama menggunakan alokasi Admin sendiri dan bisa memakai **Tanpa batas total foto**. Unduh PNG 1200px
   atau buka **Cetak** untuk kartu QR. URL berasal dari `PUBLIC_URL` server.
3. Tamu memindai QR dan menekan **Aktifkan kamera**. Sesi server mendapat token
   cookie HttpOnly unik. Kamera depan menjadi pilihan awal. Tersedia ganti kamera,
   timer, capture, retake, preview, dan save. Pilihan file tersedia sebagai fallback.
4. Tamu dapat menulis **pesan opsional (maksimal 500 karakter)** pada pratinjau foto.
   **Save photo** mengunggah foto dan pesan ke API. Pesan tampil di bawah foto pada
   galeri dan pratinjau besar. Setelah file tervalidasi dan
   transaksi berhasil, foto masuk galeri, total kuota serta kuota sesi diperbarui.
   Pengiriman ulang memakai idempotency key untuk menghindari foto/counter ganda.
5. **Galeri** menampilkan foto terbaru, lazy thumbnails, pratinjau besar, unduh,
   pagination 24 foto, dan refresh otomatis tiap 15 detik.
6. **Usage & sessions** menampilkan sesi dan kuota aktual. **Photo library** dapat
   mencari berdasarkan nama file/QR/ID, memfilter QR dan tanggal WIB, preview, serta
   mengedit pesan, memutar atau menghapus foto. Foto yang dihapus tidak mengembalikan kuota pemakaian.

Untuk mengulang uji kamera browser, jalankan `npm run build` lalu
`node --experimental-sqlite tests/browser-camera.mjs`. Tes memakai profil sementara
dan kamera sintetis. Di luar instalasi Edge standar Windows, tentukan lokasi
Chrome atau Edge melalui `CHROMIUM_BIN`.

## Aturan kuota yang perlu diketahui

- Kapasitas sesi = `floor(total / per_session)`. Contoh 100/3 = 33 sesi, 1 foto
  tidak teralokasi. Sisa itu tidak dapat dipakai oleh sesi tambahan.
- Memulai sesi memesan slot, tetapi belum mengurangi counter foto. Sesi berlaku
  24 jam; sesi kedaluwarsa tanpa foto melepaskan slot. Sesi dengan foto tetap
  tercatat dan dihitung dalam kapasitas meski sudah kedaluwarsa.
- Satu browser dapat melanjutkan sesi yang sama lewat cookie selama masih berlaku.
  Hapus cookie/perangkat berbeda berarti sesi baru; QR anonim tidak memverifikasi
  identitas manusia. Beri QR berbeda bila perlu batas untuk undangan tertentu.
- Kuota per sesi tidak dapat diubah setelah memiliki riwayat sesi. Kuota total
  dapat ditambah, atau dikurangi selama tetap menampung semua slot teralokasi.
- Saldo akun mencakup semua project. Total 500 dengan alokasi 100, 150, dan 200 menyisakan 50 foto untuk QR lain. Menonaktifkan QR tetap mencadangkan alokasinya. Menghapus QR menutup sesi dan melepas alokasi yang belum digunakan. Pemakaian dan riwayat foto tetap tersimpan.
- Akun baru mulai dengan kuota 0 sampai Admin memberikan kuota. Untuk database lama, jalankan `npm run db:init` sebelum memperbarui deployment Turso. QR lama mengikuti pemilik project karena versi sebelumnya tidak mencatat pembuat. Kuota awal akun lama mencakup seluruh alokasi yang sudah ada.
- Semua counter dan validasi dilakukan dalam transaksi tulis (`BEGIN IMMEDIATE`
  lokal atau `write` libSQL). Dua
  request bersamaan tidak dapat melewati limit. File dibersihkan saat rollback;
  file orphan lokal akibat crash dibersihkan pada startup setelah berumur satu jam.
  Mode cloud mempertahankan Blob jika hasil COMMIT belum diketahui; lihat panduan
  Vercel untuk rekonsiliasi dan backup.

## Build dan menjalankan satu server

```powershell
npm run build
npm start
```

Tanpa `.env`, build lokal disajikan di http://localhost:3001. Jika sebelumnya
`PUBLIC_URL` diatur untuk Vite, ubah menjadi `http://localhost:3001` saat menjalankan
build lokal. Backend menolak mutasi dari Origin lain; jangan menonaktifkan cek ini.

## Deployment Vercel

Ikuti **[panduan Vercel](docs/VERCEL.md)** untuk menyiapkan database Turso, public
Blob store, environment, schema, serta akun admin. Routing Function dan SPA sudah
tersedia di `vercel.json`. Data acara tidak disimpan ke disk Vercel.
Saat memperbarui deployment lama untuk fitur multi-project, jalankan `npm run db:init`
dengan `.env` menunjuk Turso sebelum redeploy. Database lokal diperbarui otomatis
saat server dimulai. Migrasi menempatkan QR lama di **Pernikahan utama**, milik admin tertua. Akun admin yang sudah ada tetap berperan sebagai Admin Utama. Tautan `/camera/kode-lama` dan galeri bawaan tetap tersedia. Mengganti username mengubah alamat undangan studio.

## Deployment HTTPS pada VPS (mode lokal)

Jalankan pada satu host Linux/Windows dengan persistent volume. Akses kamera pada
ponsel memerlukan HTTPS; pengecualian localhost hanya berlaku pada perangkat yang
menjalankan browser. Alamat IP LAN melalui HTTP tidak cukup untuk kamera.

Contoh environment produksi:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
PUBLIC_URL=https://photos.your-wedding.com
DATA_DIR=/app/data
TRUST_PROXY=1
```

Pasang reverse proxy HTTPS (Caddy/Nginx), terapkan sertifikat valid, lalu forward
ke port 3001. `TRUST_PROXY=1` hanya bila aplikasi ada di belakang **satu proxy
tepercaya**, dan port backend tidak dapat diakses langsung publik. Batas request
proxy minimal 13 MB. Server produksi menolak konfigurasi tanpa PUBLIC_URL HTTPS.

Contoh Caddyfile (ganti domain):

```caddyfile
photos.your-wedding.com {
    request_body { max_size 13MB }
    reverse_proxy 127.0.0.1:3001
}
```

Container tersedia:

```powershell
docker build -t vows-views .
# Isi .env.production dengan konfigurasi dan provisioning admin pertama.
docker run -d --name vows-views --restart unless-stopped --env-file .env.production -p 127.0.0.1:3001:3001 -v wedding-data:/app/data vows-views
```

Gunakan volume yang sama setiap restart. Jangan deploy ke filesystem ephemeral,
network filesystem, atau beberapa replika dengan SQLite. Untuk scale-out, pindah
database dan storage ke layanan bersama. Adapter Turso + Vercel Blob sudah tersedia
untuk Vercel; lihat panduan di atas.

Backup: hentikan proses aplikasi dengan graceful shutdown, salin **seluruh**
`DATA_DIR` (database, WAL bila ada, dan folder photos) sebagai satu snapshot,
lalu jalankan kembali. Restore hanya ketika aplikasi berhenti. Uji restore
secara berkala. Tombstone foto dipertahankan untuk audit, sedangkan file foto dan
thumbnail dihapus dari storage. Respons media dapat tersimpan di cache browser
hingga 60 detik setelah penghapusan.

Foto berada pada galeri publik untuk siapa pun yang memiliki URL acara. Sebelum
menyimpan, UI memberi tahu tamu bahwa foto akan dibagikan. Original EXIF (termasuk
lokasi) dibuang saat encode JPEG. Tentukan kebijakan retensi dan persetujuan acara
sebelum memakai data tamu sebenarnya.

## Verifikasi

Di **Dashboard → Theme Settings**, pilih project, lalu pilih salah satu dari 10 desain. Pratinjau menampilkan halaman pada lebar 390, 768, atau 1200 px. Cover, potret pasangan, latar, ornamen, nama, warna, font dan tombol kamera dapat diubah bersama. **Apply Theme** dan **Save Changes** menerbitkan seluruh draf untuk project terpilih. **Cancel** membuang draf; **Reset Theme** menyiapkan tampilan awal untuk disimpan, sambil mempertahankan konten acara dan foto pasangan. Pengaturan tema tidak mengubah filter atau kuota kamera.

Konfigurasi berada di `projects.event_json`, aset di `project_images`. Database SQLite lokal dimigrasikan saat startup. Untuk instalasi Turso lama, jalankan `npm run db:init` pada database target sebelum merilis versi ini agar slot potret pasangan tersedia. Lihat [panduan Vercel](docs/VERCEL.md).

Banner siap dibagikan: [Story/Status 1080 × 1920](docs/promosi/vows-views-story-status.png) dan [Feed 1080 × 1350](docs/promosi/vows-views-feed-portrait.png). Harga paket Rp 500 / satu limit foto digital. Kedua versi menggunakan file QR demo `wedding-qr-04eba327-8ade-4697-b363-6e85ae550138.png` dan WhatsApp studio +62 889-0596-6493. Jalankan `node scripts/render-promotions.mjs` untuk mengekspor ulang. Foto ilustrasi lokal digunakan pada kedua banner dan sebagai sampul bawaan koleksi tema baru.

```powershell
npm run build
npm test
```

Pengujian memakai SQLite sementara dan fixture gambar sintetis; tidak mengubah
data acara. Mencakup autentikasi, CSRF/Origin, cookie/session, QR CRUD dan PNG,
slot sesi, expiry, upload sukses/gagal, validasi MIME/decode/size, unggahan
bersamaan, idempotency, rollback database, penghapusan tanpa refund kuota,
filter/pagination, dan persistensi settings. Server memberi respons 503 ketika
empat upload masih diproses; client dapat mencoba Save lagi dengan key yang sama.
Rate limit IP disesuaikan agar mendukung tamu di jaringan Wi-Fi bersama. Suite API
juga dijalankan melalui client libSQL asinkron. Test cloud memeriksa konfigurasi
serverless, shared rate limit, upload/cleanup Blob, dan redirect media dengan SDK
palsu; koneksi akun cloud tetap perlu smoke test setelah deploy.

Pemeriksaan browser dan batas pengujian perangkat dicatat di
[docs/VERIFICATION.md](docs/VERIFICATION.md). Kamera fisik Safari iOS/Chrome Android
perlu uji di domain HTTPS menggunakan perangkat sebenarnya sebelum hari acara.

## Struktur

```text
server/        API, schema, database transaction, auth dan storage
src/           React guest, camera, gallery dan admin studio
public/        Aset statis
tests/         Integration test API + database + storage
docs/          Arsitektur dan bukti verifikasi
data/          Runtime database + foto (ignored)
```

Hero menggunakan foto ilustrasi dari [d i e g o Authentic / Unsplash](https://unsplash.com/photos/KKvXIWSZnWs),
diakses melalui images.unsplash.com. Itu aset dekoratif landing, bukan data foto
tamu. Font [Cormorant Garamond dan DM Sans](https://fonts.google.com/) melalui Google
Fonts; ikon [Lucide](https://lucide.dev/). Semua dapat diganti dengan aset acara
sendiri; untuk deployment tanpa layanan aset eksternal, host font dan hero lokal.
