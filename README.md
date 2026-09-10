# Portal Panduan Hardware IT - RS Awal Bros Botania

Aplikasi web portal panduan mandiri dan troubleshooting hardware/jaringan IT Rumah Sakit Awal Bros Botania.

## Struktur Project (Setelah Refactoring)

```text
stitch_rs_awal_bros_hardware_guidebook/
│
├── index.html                  # File HTML utama (struktur semantik & layout aplikasi)
│
├── css/
│   └── styles.css              # Custom layout styles & animasi keyframes (pulse, typing bounce)
│
├── js/
│   ├── tailwind.config.js      # Konfigurasi tema Tailwind (warna korporat RS, font Inter/Montserrat)
│   ├── sop-data.js             # Master data SOP untuk seluruh modul perangkat
│   ├── navigation.js           # Pengatur navigasi tab SPA & view detail SOP
│   ├── search.js               # Logika pencarian instan, filter kata kunci, dan quick category filter
│   ├── contact-modal.js        # Handler interaksi modal kontak darurat IT Siaga
│   ├── gemini-agent.js         # Asisten AI Gemini interaktif (SOP diagnostik cerdas & dialog chat)
│   └── main.js                 # Event listener inisialisasi aplikasi (Enter key binding pada search)
│
├── DESIGN.md                   # Spesifikasi panduan desain & token visual
├── screen.png                  # Dokumentasi tangkapan layar antarmuka
├── code.html                   # File referensi export awal sebelum refactoring
└── README.md                   # Dokumentasi teknis project
```

## Pembagian Tanggung Jawab Modul

1. **`index.html`**:
   - Memuat kerangka antarmuka: Header & navigasi, Banner pencarian, Modul kartu perangkat (8 SOP), Halaman detail SOP, Halaman kategori hardware, Halaman kontak IT siaga, Modal kontak darurat, Floating Action Button (FAB), serta Modal Chat Asisten IT Gemini.
   - Bersih dari blok script inline besar dan tag `<style>` inline.

2. **`css/styles.css`**:
   - Mengatur `scroll-behavior: smooth`.
   - Mengatur tampilan visibilitas SPA `.view-content` dan `.view-content.active`.
   - Mengatur animasi `@keyframes pulse` dan `@keyframes typingBounce` untuk indikator status & respon Gemini AI.

3. **`js/tailwind.config.js`**:
   - Berisi konfigurasi warna (`hospital-navy`, `hospital-teal`, `hospital-red`, `hospital-surface`, dsb.) dan font keluarga (`Inter`, `Montserrat`).

4. **`js/sop-data.js`**:
   - Memuat objek database `SOP_DATABASE` berisi seluruh data SOP mandiri: Cache SIMRS, Jaringan LAN, Printer Resep Thermal, Power PC Mati Total, Monitor No Signal, Mouse & Keyboard USB, Mini PC Dokter, dan Kamera CCTV.

5. **`js/navigation.js`**:
   - `switchTab(targetTab)`: Navigasi tab SPA (Beranda, Kategori, Kontak).
   - `openDedicatedSOP(sopKey)`: Mengisi data SOP terpilih ke DOM dan membuka tampilan detail SOP.
   - `backToHomeView()`: Navigasi kembali ke Beranda dari detail SOP.
   - `askGeminiFromCurrentSOP()`: Mengirim prompt SOP aktif langsung ke asisten chat Gemini AI.

6. **`js/search.js`**:
   - `executeSearch()`: Membaca input kata kunci dan memfilter kartu modul perangkat.
   - `quickFilter(term)`: Filter cepat berdasarkan kata kunci.
   - `filterByDirectCategory(catKey)`: Filter kategori dari menu Klasifikasi Perangkat.
   - `filterCardsByKeyword(query)`: Pencocokan teks dan pengaturan visibilitas kartu serta badge jumlah panduan.
   - `resetSearch()`: Menyetel ulang pencarian dan menampilkan seluruh kartu kembali.

7. **`js/contact-modal.js`**:
   - `openContactModal()`: Membuka dialog modal kontak IT Siaga.
   - `closeContactModal()`: Menutup dialog modal kontak.
   - Event listener klik di luar backdrop modal untuk auto-close.

8. **`js/gemini-agent.js`**:
   - `toggleGeminiChat()`, `openGeminiChatWithFocus()`, `clearGeminiInput()`, `openGeminiWithPrompt()`: Kontrol tampilan dan fokus jendela chat.
   - `submitGeminiMessage(event)`: Pengiriman pertanyaan pengguna.
   - `processUserMessage(message)`: Simulasi respons cerdas, typing indicator animasi, dan bubble chat.
   - `generateSOPResponse(query)`: Pencocokan keyword medis/IT dengan basis SOP resmi RS Awal Bros.
   - `resetGeminiConversation()`: Mengembalikan riwayat chat ke sambutan awal.

9. **`js/main.js`**:
   - Menghubungkan event listener `DOMContentLoaded` untuk listener tombol Enter pada pencarian.

## Menjalankan Project

### 1. Panduan Menjalankan Secara Native Tanpa Docker (Node.js & PostgreSQL)

Bagi pengembang atau rekan tim yang menerima arsip source code project ini, aplikasi dapat langsung dijalankan secara native tanpa Docker dengan langkah-langkah berikut:

#### A. Prasyarat Sistem
- **Node.js**: v18.x atau v20.x LTS (direkomendasikan v20+ LTS)
- **PostgreSQL**: v14.x atau v15.x (service aktif berjalan lokal pada port 5432)

#### B. Langkah Setup Cepat

1. **Buat Database PostgreSQL**:
   Pastikan service PostgreSQL berjalan, lalu buat database untuk project ini:
   ```sql
   CREATE DATABASE rs_awal_bros_kb;
   ```

2. **Salin File Konfigurasi Environment**:
   Salin file `.env.example` menjadi `.env`:
   ```bash
   # Di Windows (Command Prompt / PowerShell):
   copy .env.example .env

   # Di Linux / macOS:
   cp .env.example .env
   ```
   Buka file `.env` dan sesuaikan username/password PostgreSQL lokal Anda pada baris `DATABASE_URL`:
   ```ini
   DATABASE_URL=postgresql://postgres:password_anda@localhost:5432/rs_awal_bros_kb
   ```

3. **Install Dependensi Proyek**:
   ```bash
   npm install
   ```

4. **Inisialisasi Database (Migrasi, Master Data SOP, dan Akun Admin)**:
   Jalankan satu perintah terpadu:
   ```bash
   npm run setup
   ```
   > *Catatan: Perintah `npm run setup` secara otomatis menjalankan tiga tahapan berturut-turut:*
   > - `npm run migrate:up` (Menerapkan skema tabel, indeks relasional, dan vector Full-Text Search)
   > - `npm run seed:sop` (Mengisi master 8 modul SOP dasar RS Awal Bros secara idempoten)
   > - `npm run seed:admin` (Membuat akun Bootstrap Administrator IT awal)

5. **Jalankan Server Aplikasi**:
   ```bash
   # Mode Development (auto-reload):
   npm run dev

   # Atau Mode Standar / Production:
   npm start
   ```

6. **Akses Antarmuka di Browser**:
   - **Portal Pengguna Publik**: `http://localhost:3000`
   - **Portal Admin & Staf IT**: `http://localhost:3000/admin/login`
     - **Username**: `admin.it`
     - **Password**: `AwalBrosIT@2026`
   - **Liveness Probe**: `http://localhost:3000/api/v1/health`
   - **Readiness Probe**: `http://localhost:3000/api/v1/health/ready` (memverifikasi status `database: "connected"`)

7. **Menjalankan Validasi Automated Test Suite**:
   ```bash
   npm test
   ```
   *(Seluruh 12 test suite M0–M11 akan dijalankan dan terverifikasi 100% PASS).*

### 2. Public REST API Endpoints (M3)
Platform menyediakan Public REST API read-only berbasis PostgreSQL:

- **`GET /api/v1/categories`**: Mengembalikan daftar kategori aktif yang memiliki panduan `PUBLISHED` beserta jumlah panduannya.
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "name": "Farmasi & Kasir",
        "slug": "farmasi-kasir",
        "icon": "print",
        "description": "...",
        "display_order": 3,
        "guide_count": 1
      }
    ],
    "meta": { "count": 8 }
  }
  ```

- **`GET /api/v1/guides`**: Mengembalikan seluruh panduan berstatus `PUBLISHED` (opsional filter kategori: `?category=slug`).
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "uuid",
        "key_code": "printer",
        "title": "Printer Tidak Berfungsi / Resep Macet",
        "location_scope": "Kasir, Screening & Farmasi",
        "status": "PUBLISHED",
        "category": { "id": "uuid", "name": "Farmasi & Kasir", "slug": "farmasi-kasir", "icon": "print" }
      }
    ],
    "meta": { "count": 8 }
  }
  ```

- **`GET /api/v1/guides/:id_or_key`**: Mengembalikan detail lengkap panduan berdasarkan `key_code` (misal: `/api/v1/guides/printer`) atau `UUID`, lengkap dengan relasi kategori dan urutan langkah deterministik (`step_number` 1 -> 2 -> 3).
  ```json
  {
    "success": true,
    "data": {
      "id": "uuid",
      "key_code": "printer",
      "title": "Printer Tidak Berfungsi / Resep Macet",
      "category": { "name": "Farmasi & Kasir", "slug": "farmasi-kasir" },
      "steps": [
        { "step_number": 1, "title": "Langkah 1: ...", "instruction": "..." },
        { "step_number": 2, "title": "Langkah 2: ...", "instruction": "..." },
        { "step_number": 3, "title": "Langkah 3: ...", "instruction": "..." }
      ]
    }
  }
  ```

### 3. Admin Authentication & Provisioning API (M5)
Platform menyediakan sistem autentikasi internal berbasis session JWT di dalam HttpOnly Cookie, tanpa registrasi publik:

- **`POST /api/v1/auth/login`**: Login staf IT (body: `{ username, password }`). Menghasilkan HttpOnly cookie aman (`SameSite=Strict`).
- **`POST /api/v1/auth/logout`**: Mengakhiri sesi dan membersihkan auth cookie.
- **`GET /api/v1/auth/me`**: Mendapatkan data profil aktif staf yang sedang login.
- **`POST /api/v1/admin/users`**: Pembuatan akun baru internal (hanya dapat diakses oleh `ADMIN` atau `IT_MANAGER`).
  - `ADMIN`: Dapat membuat akun `ADMIN`, `IT_MANAGER`, dan `IT_SUPPORT`.
  - `IT_MANAGER`: Hanya dapat membuat akun `IT_SUPPORT` (privilege escalation ditolak dengan HTTP 403).
  - `IT_SUPPORT`: Tidak dapat membuat akun (HTTP 403).
- **`PATCH /api/v1/admin/users/:id/status`**: Mengaktifkan atau menonaktifkan akun (`{ is_active: boolean }`).

#### Bootstrap Administrator CLI:
Untuk inisialisasi akun Administrator pertama secara aman:
```bash
npm run seed:admin
# Atau dengan custom arguments:
node database/seed-admin.js [username] [password] [fullName] [email]
```

### 4. Admin Knowledge Base Management API (M6)
Platform menyediakan REST API untuk manajemen penuh kategori, panduan troubleshooting, langkah-langkah SOP, dan transisi siklus hidup panduan dengan autentikasi berbasis role dan audit logging:

#### Categories Management:
- **`GET /api/v1/admin/categories`**: Mendapatkan semua kategori (termasuk non-aktif) beserta jumlah panduan terkait (`ADMIN`, `IT_MANAGER`, `IT_SUPPORT`).
- **`POST /api/v1/admin/categories`**: Menambahkan kategori baru (`ADMIN`, `IT_MANAGER`). Validasi slug unik dan otomatis.
- **`PATCH /api/v1/admin/categories/:id`**: Memperbarui informasi kategori (`ADMIN`, `IT_MANAGER`).
- **`PATCH /api/v1/admin/categories/:id/status`**: Mengaktifkan/menonaktifkan status kategori (`ADMIN`, `IT_MANAGER`).

#### Guides & Steps Management:
- **`GET /api/v1/admin/guides`**: Mendapatkan seluruh panduan troubleshooting lintas status (`DRAFT`, `PUBLISHED`, `ARCHIVED`) dengan filter opsional `?status=` dan `?category=` (`ADMIN`, `IT_MANAGER`, `IT_SUPPORT`).
- **`GET /api/v1/admin/guides/:id`**: Mendapatkan detail lengkap panduan beserta langkah-langkah (steps) dan relasi kategori (`ADMIN`, `IT_MANAGER`, `IT_SUPPORT`).
- **`POST /api/v1/admin/guides`**: Menambahkan masalah troubleshooting baru lengkap dengan langkah-langkah dalam transaksi atomik (`ADMIN`, `IT_MANAGER`).
- **`PATCH /api/v1/admin/guides/:id`**: Memperbarui metadata panduan (`ADMIN`, `IT_MANAGER`).
- **`PATCH /api/v1/admin/guides/:id/status`**: Mengubah status siklus hidup panduan secara deterministik:
  - `DRAFT` → `PUBLISHED` (otomatis menetapkan `published_at` dan panduan langsung aktif di Public API)
  - `PUBLISHED` → `ARCHIVED` (panduan langsung dihapus dari Public API)
  - `DRAFT` → `ARCHIVED`
  - Transisi ilegal lainnya ditolak dengan `HTTP 400`.
- **`PUT /api/v1/admin/guides/:id/steps`**: Mengganti urutan langkah troubleshooting secara atomik dengan penomoran deterministik (1, 2, 3...) (`ADMIN`, `IT_MANAGER`).

### 5. Admin Dashboard UI & User Management (M7 & M8)
Portal administratif berbasis SPA modern diakses melalui `/admin/login` dan `/admin`:
- **`GET /api/v1/admin/users`**: Daftar akun staf IT aktif dan non-aktif (`ADMIN`, `IT_MANAGER`, `IT_SUPPORT`).
- **`GET /api/v1/admin/audit-logs`**: Log audit seluruh mutasi sistem dan aktivitas login.

---

## Deployment & Containerization (M9)

Aplikasi RS Awal Bros Botania Knowledge Base telah dikemas dan diperkuat (*production-hardened*) untuk deployment enterprise berbasis container Docker.

### 1. Prasyarat Sistem
- **Docker Engine** v20.10+ atau **Docker Desktop**
- **Docker Compose** v2.0+ (atau `docker compose`)

### 2. Variabel Lingkungan Produksi (.env)
Pastikan file `.env` diisi dengan kredensial produksi yang aman:
```ini
# Server Configuration
PORT=3000
NODE_ENV=production

# Database Configuration (PostgreSQL)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=ganti-dengan-password-database-yang-kuat!
POSTGRES_DB=rs_awal_bros_kb
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:ganti-dengan-password-database-yang-kuat!@postgres:5432/rs_awal_bros_kb

# Keamanan Autentikasi (WAJIB minimal 32 karakter unik di lingkungan production)
JWT_SECRET=rahasia-jwt-produksi-rs-awal-bros-botania-sangat-aman-2026!
```

> [!IMPORTANT]
> **Aturan Validasi Produksi (`NODE_ENV=production`)**:
> Aplikasi memiliki pengaman fail-fast pada saat startup. Jika `JWT_SECRET` kosong, kurang dari 32 karakter, atau menggunakan placeholder default, server Express akan langsung menolak boot dan menghentikan proses dengan kode status 1.

### 3. Menjalankan Stack dengan Docker Compose
Untuk menjalankan seluruh stack (Node.js Express App + PostgreSQL Database) dalam satu perintah:

```bash
# Build dan jalankan container di background
docker compose up --build -d

# Memeriksa status kesehatan container
docker compose ps

# Memeriksa log aplikasi dan database secara realtime
docker compose logs -f app
```

Akses aplikasi di browser:
- **User Portal Publik**: `http://localhost:3000`
- **Admin Dashboard**: `http://localhost:3000/admin/login`
- **Liveness Probe**: `http://localhost:3000/api/v1/health`
- **Readiness Probe**: `http://localhost:3000/api/v1/health/ready`

### 4. Perilaku Otomatisasi Saat Container Dimulai
Saat container `app` pertama kali boot (`docker-entrypoint.sh`):
1. **Pemeriksaan Healthcheck Database**: Layanan `app` menunggu PostgreSQL hingga berstatus `healthy` (`pg_isready`).
2. **Migrasi Database Otomatis**: Menjalankan `node database/migrate.js up` untuk memastikan seluruh tabel skema termutakhir telah diterapkan.
3. **Seeding Awal Idempoten**: Menjalankan `node database/seed-sop-data.js` untuk mengisi 8 modul SOP dasar RS Awal Bros (hanya jika tabel panduan masih kosong).
4. **Boot Server**: Menjalankan server aplikasi di bawah user unprivileged (`node`, non-root).

### 5. Fitur Keamanan Produksi (*Hardening*)
- **Container Non-Root**: Proses di dalam container berjalan di bawah akun `node` (`USER node`).
- **HTTP Security Headers**: Dilengkapi `Content-Security-Policy` (dibatasi pada domain internal, Tailwind CDN, dan Google Fonts), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, dan `Strict-Transport-Security` (HSTS pada mode produksi).
- **Authentication Rate Limiting**: Endpoint `POST /api/v1/auth/login` dibatasi maksimal **10 percobaan per 15 menit per IP**. Jika melebihi batas, server merespons dengan `HTTP 429 Too Many Requests` dan menyertakan header `Retry-After`.
- **Trust Proxy Aware**: Dikonfigurasi dengan `app.set('trust proxy', 1)` agar IP klien tercatat secara akurat pada audit log dan rate limiter saat berada di balik reverse proxy atau Docker network.
- **Graceful Shutdown**: Server mendengarkan sinyal `SIGTERM` dan `SIGINT` untuk menyelesaikan request aktif yang sedang berjalan sebelum memutus koneksi pool database secara bersih dalam batas waktu 10 detik.

### 6. Menghentikan Layanan
```bash
# Menghentikan seluruh container dengan aman
docker compose down

# Atau menghentikan container sekaligus menghapus volume database (HATI-HATI: DATA AKAN HILANG)
docker compose down -v
```

---

### 7. Fitur Pencarian Cerdas & Asisten Diagnostik AI (M10)

Platform kini mengintegrasikan PostgreSQL Full-Text Search dan Asisten AI Diagnostik yang ter-grounding secara ketat pada SOP resmi RS Awal Bros:

1. **PostgreSQL Full-Text Search (`GET /api/v1/guides?search=...` / `?q=...`)**:
   - Memanfaatkan infrastruktur `search_vector TSVECTOR` PostgreSQL dengan query terparameterisasi `plainto_tsquery('indonesian', ...)`.
   - Mengurutkan hasil relevansi pencarian menggunakan `ts_rank(...) DESC`.
   - Menjamin isolasi data: panduan berstatus `DRAFT`, `ARCHIVED`, maupun kategori non-aktif tidak akan pernah muncul di portal publik.
   - Dilengkapi graceful fallback `ILIKE` yang tahan terhadap kegagalan mock lingkungan pengujian.
   - Frontend `js/search.js` terhubung langsung ke API pencarian backend dan mendegradasi secara transparan jika koneksi offline.

2. **Asisten AI Diagnostik IT Ter-grounding (`POST /api/v1/ai/diagnose`)**:
   - **PostgreSQL Sebagai Sumber Kebenaran Tunggal**: Konten SOP resmi dari database PostgreSQL dijadikan konteks acuan wajib sebelum memanggil model AI.
   - **Kunci API Rahasia Tetap di Sisi Server**: `GEMINI_API_KEY` dikonfigurasi melalui environment variable server dan **tidak pernah diekspos** ke kode klien/browser.
   - **Batasan Keselamatan Klinis (*Medical Guardrail*)**: Permintaan diagnosa medis, keluhan klinis pasien, maupun resep obat langsung ditolak secara aman (`SAFETY_REFUSAL`) dan diarahkan ke IGD / Tim Code Blue Medis.
   - **Degradasi Lokal Anggun (*Graceful Local Fallback*)**: Jika kunci Gemini tidak dikonfigurasi, kuota habis, terjadi error jaringan, atau timeout (8 detik), endpoint secara otomatis mengembalikan prosedur SOP resmi dari database PostgreSQL (`DATABASE_SOP_GROUNDED` / `DATABASE_SOP_FALLBACK`).
   - **Proteksi Rate Limiting Khusus**: Dibatasi maksimal **15 permintaan per 15 menit per IP**. Request berlebih menerima status `HTTP 429 Too Many Requests` beserta header `Retry-After`.
   - **Validasi Input**: Pertanyaan pengguna dibatasi maksimal 500 karakter untuk mencegah penyalahgunaan token AI.

3. **Menjalankan Pengujian M10**:
   ```bash
   # Menjalankan test suite mandiri M10:
   npm run test:m10

   # Atau seluruh rangkaian pengujian sistem M0–M11:
   npm test
   ```

---

### 8. Observabilitas, Penanganan Error Terpusat & Diagnostik Operasional (M11)

Platform kini dilengkapi fondasi observabilitas dan penanganan error terpusat tanpa dependensi eksternal (*zero third-party logging/monitoring dependencies*):

1. **Korelasi Request (*Request Correlation ID*)**:
   - Setiap request HTTP secara otomatis diberikan `X-Request-Id` berbasis Node.js `crypto.randomUUID()`.
   - Mendukung pelestarian header `X-Request-Id` aman dari klien (8–64 karakter alfanumerik) untuk penelusuran terpadu (*end-to-end tracing*). Header yang tidak valid atau berbahaya secara otomatis diganti dengan UUID v4 aman.
   - Header `X-Request-Id` dikembalikan pada setiap respon HTTP dan dicantumkan pada seluruh objek payload error.

2. **Logger Terstruktur Terpusat (*Centralized Structured Logger*)**:
   - `server/utils/logger.js` mendukung level log `info`, `warn`, `error`, dan `debug`.
   - Mengeluarkan format JSON terstruktur pada lingkungan produksi (`NODE_ENV=production` atau `LOG_FORMAT=json`) dan format human-readable terstruktur pada lingkungan pengembangan.
   - **Redaksi Rahasia Otomatis**: Secara rekursif menyamarkan data sensitif seperti kata sandi (`password`, `password_hash`), token JWT (`jwt`, `token`), cookies, `Authorization` header, dan `GEMINI_API_KEY` menjadi `[REDACTED]`.

3. **Penanganan Error Terpusat (*Global Centralized Error Handler*)**:
   - Middleware `server/middleware/error-handler.js` menjamin seluruh error API dikembalikan dalam format JSON terstandarisasi:
     ```json
     {
       "success": false,
       "error": {
         "code": "INTERNAL_SERVER_ERROR",
         "message": "Terjadi kesalahan internal pada server.",
         "requestId": "a0a4b963-d501-4fd0-83fa-4fc73a92f6da"
       }
     }
     ```
   - Menangani error parsing payload JSON (`express.json()`) dengan kode `INVALID_JSON_PAYLOAD` (HTTP 400).
   - Menjamin tidak ada kebocoran *stack trace*, query SQL, maupun path internal server ke klien publik.

4. **Metrik Operasional Ringan In-Memory**:
   - `server/utils/metrics.js` melacak waktu aktif (*uptime*), penggunaan memori (*heap* dan *RSS*), jumlah request berdasarkan status family (`2xx`, `3xx`, `4xx`, `5xx`), rata-rata latensi respon, event rate limit, event diagnostik AI (permintaan, penolakan medis, fallback SOP), dan latensi pencarian SOP.

5. **Endpoint Metrik Terproteksi RBAC (`GET /api/v1/admin/metrics`)**:
   - Hanya dapat diakses oleh peran berwenang (`ADMIN` dan `IT_MANAGER`).
   - Peran `IT_SUPPORT` menerima penolakan `HTTP 403 Forbidden` (`FORBIDDEN_RESOURCE`).
   - Request tanpa autentikasi menerima `HTTP 401 Unauthorized`.

6. **Diagnostik Liveness & Kesiapan Sistem**:
   - `GET /api/v1/health` diperkaya dengan informasi runtime `uptime` dan ringkasan penggunaan memori tanpa merusak kontrak respons `status: "ok"`.
   - `GET /api/v1/health/ready` mempertahankan kontrak kesiapan koneksi pool PostgreSQL.

7. **Menjalankan Pengujian M11**:
   ```bash
   # Menjalankan test suite mandiri M11:
   npm run test:m11

   # Menjalankan seluruh pengujian regresi lengkap M0–M11 (12 test suite):
   npm test
   ```

---

### 9. Membuka Frontend Langsung (Static Fallback)
Buka file `index.html` langsung di browser modern, atau gunakan HTTP server sederhana:
```bash
python -m http.server 8000
```
