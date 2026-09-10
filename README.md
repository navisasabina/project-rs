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

### 1. Menggunakan Node.js Backend Server (Rekomendasi)
```bash
# Menjalankan server backend (otomatis melayani User Portal & API)
npm run dev

# Atau mode production:
npm start

# Uji seluruh automated test suite (database, seed, public api, health):
npm test

# Atau uji spesifik public api:
npm run test:api
```
Akses di browser melalui `http://localhost:3000` (User Portal) dan `http://localhost:3000/api/v1/health` (API Health Check).

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

### 7. Membuka Frontend Langsung (Static Fallback)
Buka file `index.html` langsung di browser modern, atau gunakan HTTP server sederhana:
```bash
python -m http.server 8000
```




