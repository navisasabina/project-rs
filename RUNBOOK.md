# Manual Operasional & Disaster Recovery (Runbook)
**Platform IT Hardware Guidebook & Knowledge Base — RS Awal Bros Botania**

Buku panduan operasional ini disusun untuk tim IT Support, Database Administrator (DBA), dan System Administrator RS Awal Bros Botania dalam mengelola siklus hidup aplikasi, prosedur backup, pemulihan bencana (Disaster Recovery), rotasi kredensial, serta mitigasi insiden sistem.

---

## Daftar Isi
- [A. Initial Setup (Instalasi Awal)](#a-initial-setup-instalasi-awal)
- [B. Native Startup (Menjalankan Tanpa Docker)](#b-native-startup-menjalankan-tanpa-docker)
- [C. Docker Startup (Menjalankan Menggunakan Docker Compose)](#c-docker-startup-menjalankan-menggunakan-docker-compose)
- [D. Database Backup (Prosedur Pencadangan)](#d-database-backup-prosedur-pencadangan)
- [E. Backup Retention (Kebijakan Retensi Berkas Backup)](#e-backup-retention-kebijakan-retensi-berkas-backup)
- [F. Restore Procedure (Prosedur Pemulihan Database)](#f-restore-procedure-prosedur-pemulihan-database)
- [G. Restore Verification (Verifikasi Integritas Pasca-Restore)](#g-restore-verification-verifikasi-integritas-pasca-restore)
- [H. Disaster Recovery Scenario (Skenario Pemulihan Bencana Total)](#h-disaster-recovery-scenario-skenario-pemulihan-bencana-total)
- [I. Database Corruption Scenario (Skenario Kerusakan Database)](#i-database-corruption-scenario-skenario-kerusakan-database)
- [J. Accidental Data Deletion Scenario (Skenario Penghapusan Data Tidak Sengaja)](#j-accidental-data-deletion-scenario-skenario-penghapusan-data-tidak-sengaja)
- [K. JWT Secret Rotation (Rotasi Kunci Sesi Admin)](#k-jwt-secret-rotation-rotasi-kunci-sesi-admin)
- [L. PostgreSQL Connectivity Troubleshooting (Pemeriksaan Masalah Koneksi Database)](#l-postgresql-connectivity-troubleshooting-pemeriksaan-masalah-koneksi-database)
- [M. Application Health & Readiness Checks (Pemeriksaan Kesehatan Aplikasi)](#m-application-health--readiness-checks-pemeriksaan-kesehatan-aplikasi)
- [N. Backup Verification & Drill Procedure (Simulasi & Pengujian Berkala)](#n-backup-verification--drill-procedure-simulasi--pengujian-berkala)
- [O. Important Warnings & Destructive Operations (Peringatan Bahaya)](#o-important-warnings--destructive-operations-peringatan-bahaya)
- [P. What is NOT Automatically Backed Up (Batasan Backup Otomatis)](#p-what-is-not-automatically-backed-up-batasan-backup-otomatis)
- [Q. Recommended Operational Backup Scheduling Approach (Jadwal Otomasi)](#q-recommended-operational-backup-scheduling-approach-jadwal-otomasi)

---

## A. Initial Setup (Instalasi Awal)

### 1. Prasyarat Sistem
- **Node.js**: v18 LTS atau v20 LTS (termasuk runtime `npm`).
- **PostgreSQL**: v14, v15, atau v16 dengan utility klien (`pg_dump` dan `psql`) tersedia dalam PATH sistem.
- **Sistem Operasi**: Linux Ubuntu/Debian Server, RedHat Enterprise, atau Windows Server.
- *(Opsional)* **Docker & Docker Compose v2**: Bila menggunakan deployment berbasis container.

### 2. Konfigurasi Lingkungan (.env)
Salin berkas template lingkungan ke berkas aktif `.env`:
```bash
cp .env.example .env
```
Sesuaikan variabel penting di `.env`:
- `DATABASE_URL`: URI koneksi PostgreSQL (contoh: `postgresql://postgres:password_rahasia@localhost:5432/rs_awal_bros_kb`)
- `PORT`: Port aplikasi HTTP (default: `3000`)
- `NODE_ENV`: Set ke `production` untuk server operasional RS.
- `JWT_SECRET`: Kunci enkripsi token login admin (**WAJIB minimal 32 karakter unik dan acak**).
- `BACKUP_DIR`: Direktori penyimpanan backup (default: `backups`).
- `BACKUP_RETENTION_DAYS`: Masa simpan arsip backup lokal dalam satuan hari (default: `7`).

### 3. Instalasi Dependensi
```bash
npm ci --omit=dev
```

---

## B. Native Startup (Menjalankan Tanpa Docker)

Untuk menjalankan server langsung pada host sistem operasi rumah sakit:

1. **Pastikan Service PostgreSQL Aktif**:
   ```bash
   # Linux Systemd
   sudo systemctl status postgresql
   # Windows PowerShell
   Get-Service -Name postgresql*
   ```

2. **Jalankan Migrasi Database & Seeding Awal**:
   ```bash
   npm run setup
   ```
   *Catatan*: Perintah ini mengeksekusi migrasi skema tabel (`schema_migrations`), menginisialisasi 8 modul master SOP RS Awal Bros (secara aman dan non-destruktif), serta mendaftarkan akun awal Super Administrator.

3. **Jalankan Server Aplikasi**:
   ```bash
   # Menggunakan npm
   npm start

   # Atau menggunakan process manager production (PM2)
   pm2 start server/server.js --name "awal-bros-kb"
   ```

4. **Akses Portal**:
   - User Portal: `http://localhost:3000/`
   - Admin Login: `http://localhost:3000/admin/login`

---

## C. Docker Startup (Menjalankan Menggunakan Docker Compose)

Untuk deployment menggunakan container Docker terisolasi:

1. **Verifikasi Keamanan Konfigurasi**:
   - Port PostgreSQL pada `docker-compose.yml` telah dikunci pada `127.0.0.1:${POSTGRES_PORT:-5432}:5432` agar database tidak terekspos langsung ke jaringan eksternal/LAN.
   - Variabel `JWT_SECRET` **wajib** didefinisikan pada berkas `.env` host sebelum menjalankan container.

2. **Jalankan Layanan Container**:
   ```bash
   docker compose up -d --build
   ```

3. **Pemeriksaan Status Container**:
   ```bash
   docker compose ps
   docker compose logs -f app
   ```
   Container aplikasi menjalankan script `docker-entrypoint.sh` yang secara otomatis menjalankan `migrate:up` dan `seed:sop` dalam mode aman (non-destruktif tanpa `--force`), sehingga panduan yang telah diubah oleh tim IT RS tidak akan tertimpa saat restart container.

---

## D. Database Backup (Prosedur Pencadangan)

Aplikasi menyediakan script backup mandiri bebas dependensi pihak ketiga (`database/backup.js`) yang memanfaatkan utility standar `pg_dump`.

### 1. Menjalankan Backup
Eksekusi melalui npm script:
```bash
npm run db:backup
```
Atau langsung melalui Node.js:
```bash
node database/backup.js
```

### 2. Format & Lokasi Berkas Backup
- **Direktori**: `backups/` (dapat diatur melalui variabel `BACKUP_DIR`).
- **Pola Penamaan**: `rs_awal_bros_kb_backup_YYYY-MM-DD_HH-mm-ss.sql`
- **Format Konten**: Standar SQL Plaintext PostgreSQL dengan perintah `--clean --if-exists --no-owner --no-privileges`, mencakup seluruh tabel (`schema_migrations`, `categories`, `guides`, `guide_steps`, `users`, `audit_logs`), indeks, urutan sequence, dan constraint integritas data.

### 3. Eksekusi Backup dari Lingkungan Docker
Jika aplikasi berjalan di dalam container Docker dan database berada pada service container `db`:
```bash
docker compose exec db pg_dump -U postgres -d rs_awal_bros_kb --clean --if-exists > backups/rs_awal_bros_kb_backup_$(date +%Y-%m-%d_%H-%M-%S).sql
```

---

## E. Backup Retention (Kebijakan Retensi Berkas Backup)

Untuk mencegah kepenuhan ruang disk server RS, script backup secara otomatis membersihkan arsip lama:

1. **Jangka Waktu Retensi**:
   - Default: **7 hari** (dapat diubah melalui variabel `BACKUP_RETENTION_DAYS`).
2. **Aturan Keamanan Pembersihan**:
   - Hanya berkas yang cocok dengan pola resmi `^rs_awal_bros_kb_backup_.*\.sql$` yang akan diperiksa.
   - Berkas lain di dalam direktori `backups/` (misalnya catatan teknis, log, atau dump kustom) **tidak akan pernah dihapus**.
   - Pembersihan retensi **hanya dijalankan jika proses backup saat itu berhasil 100%**. Jika backup gagal, pembersihan dibatalkan untuk menghindari hilangnya cadangan data yang masih ada.
   - Jika nilai `BACKUP_RETENTION_DAYS` bernilai tidak valid atau `0`, pembersihan dilewati dengan aman.

---

## F. Restore Procedure (Prosedur Pemulihan Database)

Operasi pemulihan bersifat **destruktif** terhadap skema dan data yang ada pada database tujuan. Script `database/restore.js` memiliki proteksi ganda:

### 1. Perintah Restore
Perintah restore **menolak dieksekusi** tanpa konfirmasi eksplisit `--confirm`.

Format eksekusi:
```bash
node database/restore.js backups/rs_awal_bros_kb_backup_2026-09-11_14-00-00.sql --confirm
```
Atau menggunakan npm script dengan passing argumen:
```bash
npm run db:restore -- backups/rs_awal_bros_kb_backup_2026-09-11_14-00-00.sql --confirm
```

### 2. Validasi Keamanan Sebelum Restore
Sebelum menyentuh database, script `restore.js` melakukan validasi ketat:
1. Memastikan parameter `--confirm` atau `CONFIRM_RESTORE=true` disertakan.
2. Memastikan berkas backup fisik ada, memiliki ukuran > 0 byte, dan memiliki signature header valid PostgreSQL dump.
3. Memastikan database tujuan bukan database sistem cluster (`postgres`, `template0`, `template1`).
4. Menampilkan informasi host, database target, dan user secara transparan tanpa membuka password.
5. Memeriksa ketersediaan utility `psql`.

### 3. Batasan Transaksional PostgreSQL Tooling
> [!WARNING]
> Walaupun restorasi dijalankan menggunakan opsi `ON_ERROR_STOP=1`, dump SQL PostgreSQL yang mengandung statement skema majemuk (seperti pembuatan/penghapusan tabel berantai dan sequence) mungkin tidak sepenuhnya atomik jika terjadi kegagalan fatal di tengah pembacaan berkas input. Pastikan integritas berkas cadangan telah divalidasi sebelum memulai pemulihan pada server live.

---

## G. Restore Verification (Verifikasi Integritas Pasca-Restore)

Segera setelah pemulihan database selesai dieksekusi, script `database/restore.js` secara otomatis membuka koneksi verifikasi dan memeriksa jumlah baris pada tabel-tabel inti:

```text
[Restore Verification] Hasil verifikasi integritas database:
  - schema_migrations : 4 migrasi
  - categories        : 8 baris
  - guides            : 8 panduan (atau lebih)
  - guide_steps       : 24 langkah (atau lebih)
  - users             : 2 pengguna
  - audit_logs        : 15 riwayat log
```

Jika salah satu tabel vital tidak ditemukan, proses restore akan memberikan status gagal (exit code 1).

Untuk verifikasi mandiri pasca-restore, jalankan test suite kesehatan:
```bash
npm run test:health
npm run test:api
```

---

## H. Disaster Recovery Scenario (Skenario Pemulihan Bencana Total)

Jika terjadi kegagalan hardware server fisik, kerusakan storage utama, atau instalasi ulang OS:

1. **Siapkan Server Pengganti**:
   - Pasang Node.js LTS dan PostgreSQL.
   - Siapkan database baru: `CREATE DATABASE rs_awal_bros_kb;`.
2. **Deploy Kode Sumber Aplikasi**:
   - Clone repositori atau ekstrak arsip source code ZIP.
   - Jalankan `npm ci --omit=dev`.
3. **Konfigurasi Lingkungan**:
   - Buat berkas `.env` dengan kredensial database server baru dan `JWT_SECRET` production yang aman.
4. **Pindahkan Berkas Backup Terakhir**:
   - Salin berkas backup SQL terakhir dari media cadangan off-host ke folder `backups/`.
5. **Eksekusi Pemulihan Database**:
   ```bash
   node database/restore.js backups/rs_awal_bros_kb_backup_TERBARU.sql --confirm
   ```
6. **Mulai Layanan & Verifikasi**:
   ```bash
   npm start
   curl http://localhost:3000/api/v1/health/ready
   ```

---

## I. Database Corruption Scenario (Skenario Kerusakan Database)

Jika tabel PostgreSQL mengalami korupsi atau inkonsistensi relasi akibat pemadaman listrik mendadak:

1. **Hentikan Sementara Layanan HTTP**:
   ```bash
   # Hentikan server aplikasi agar tidak ada request baru yang masuk
   pm2 stop awal-bros-kb
   # Atau jika docker
   docker compose stop app
   ```
2. **Buat Snapshot Darurat Keadaan Terkini**:
   Jika database masih bisa dibaca sebagian:
   ```bash
   npm run db:backup
   ```
3. **Reset Database Bersih**:
   ```bash
   # Buat database kosong baru atau drop skema yang rusak
   psql -U postgres -c "DROP DATABASE rs_awal_bros_kb;"
   psql -U postgres -c "CREATE DATABASE rs_awal_bros_kb;"
   ```
4. **Pulihkan dari Cadangan Terakhir yang Valid**:
   ```bash
   node database/restore.js backups/rs_awal_bros_kb_backup_SEBELUM_RUSAK.sql --confirm
   ```
5. **Nyalakan Kembali Aplikasi**:
   ```bash
   pm2 restart awal-bros-kb
   # Atau jika docker
   docker compose start app
   ```

---

## J. Accidental Data Deletion Scenario (Skenario Penghapusan Data Tidak Sengaja)

Jika administrator atau staf IT tidak sengaja menghapus SOP penting atau mengubah data secara keliru:

1. **Gunakan Safe SOP Seed untuk Memulihkan SOP Dasar**:
   Jika yang terhapus adalah salah satu dari 8 SOP baseline bawaan RS Awal Bros:
   ```bash
   npm run seed:sop
   ```
   *Mode aman ini akan menyisipkan kembali SOP dasar yang hilang tanpa mengubah atau menimpa SOP lain yang sudah dimodifikasi.*

2. **Jika Membutuhkan Pemulihan Penuh dari Backup**:
   - Identifikasi berkas backup tepat sebelum waktu insiden penghapusan terjadi.
   - Pulihkan database menggunakan:
     ```bash
     node database/restore.js backups/<nama-file-backup>.sql --confirm
     ```
   - Semua panduan, langkah, dan audit trail akan kembali ke status saat backup tersebut dibuat.

---

## K. JWT Secret Rotation (Rotasi Kunci Sesi Admin)

Untuk mematuhi kebijakan keamanan berkala atau saat terjadi insiden kebocoran kredensial:

1. **Generate Secret Baru**:
   Buat string acak kriptografis minimal 32 karakter (contoh menggunakan Node.js CLI):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Perbarui Nilai `.env`**:
   Ubah nilai `JWT_SECRET` pada berkas `.env` server:
   ```ini
   JWT_SECRET=f7d8a9b2c3d4e5f6...nilai-acak-baru-minimal-32-karakter...
   ```
   > [!IMPORTANT]
   > Nilai fallback publik compose (`awal-bros-botania-prod-jwt-secret-min-32-chars`) secara otomatis ditolak oleh aplikasi pada mode `NODE_ENV=production`. Pastikan selalu menggunakan secret unik.

3. **Restart Server Aplikasi**:
   ```bash
   pm2 reload awal-bros-kb
   # Atau jika docker
   docker compose up -d
   ```
4. **Dampak Rotasi**:
   Seluruh sesi token admin yang aktif saat ini akan segera menjadi invalid. Seluruh administrator IT diwajibkan melakukan login ulang dengan kredensial masing-masing.

---

## L. PostgreSQL Connectivity Troubleshooting (Pemeriksaan Masalah Koneksi Database)

Jika aplikasi gagal terhubung ke PostgreSQL:

1. **Periksa Endpoint & Port Binding**:
   - Host binding default container PostgreSQL telah dikonfigurasi ke `127.0.0.1:5432` (atau port host custom melalui `POSTGRES_PORT`).
   - Cek apakah port aktif mendengarkan koneksi:
     ```bash
     # Linux
     netstat -tlpn | grep 5432
     # Windows PowerShell
     Test-NetConnection -ComputerName 127.0.0.1 -Port 5432
     ```

2. **Periksa Parameter Connection Pool (M12)**:
   Aplikasi mengonfigurasi batas pool connection secara eksplisit:
   - `DB_POOL_MAX` (default: `15` koneksi paralel).
   - `DB_POOL_IDLE_TIMEOUT_MS` (default: `30000` ms).
   - `DB_POOL_CONNECTION_TIMEOUT_MS` (default: `5000` ms).
   Jika server rumah sakit mengalami lonjakan koneksi (`error: remaining connection slots are reserved`), tingkatkan batas koneksi PostgreSQL di `postgresql.conf` (`max_connections`) atau sesuaikan `DB_POOL_MAX`.

3. **Uji Koneksi Mandiri**:
   ```bash
   npm run test:db
   ```

---

## M. Application Health & Readiness Checks (Pemeriksaan Kesehatan Aplikasi)

Aplikasi menyediakan endpoint observabilitas standar untuk monitoring:

1. **Liveness Probe**:
   `GET /api/v1/health/live`
   - Memastikan proses HTTP Node.js merespons request.
2. **Readiness Probe**:
   `GET /api/v1/health/ready`
   - Memastikan koneksi aktif ke PostgreSQL dapat melakukan query (`SELECT 1`).
   - Mengembalikan HTTP 200 dengan status `UP` bila siap melayani trafik medis.
   - Mengembalikan HTTP 503 dengan status `DOWN` bila database terputus.
3. **Metrics Endpoint** (Admin/Internal):
   `GET /api/v1/metrics`
   - Memantau penggunaan memori heap, RSS, uptime server, dan ringkasan pool database.

---

## N. Backup Verification & Drill Procedure (Simulasi & Pengujian Berkala)

Tim IT RS Awal Bros disarankan melakukan gladi bersih pemulihan data (Disaster Recovery Drill) minimal **sekali setiap 3 bulan**:

1. Siapkan database pengujian sementara (misal: `rs_awal_bros_kb_testdrill`).
2. Ambil berkas backup produksi terbaru: `npm run db:backup`.
3. Lakukan restore ke database drill:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rs_awal_bros_kb_testdrill node database/restore.js backups/<file_terbaru>.sql --confirm
   ```
4. Catat waktu pemulihan (Recovery Time Objective / RTO) dan pastikan seluruh 8 kategori dan panduan hardware terbaca sempurna.
5. Hapus database uji setelah simulasi selesai.

---

## O. Important Warnings & Destructive Operations (Peringatan Bahaya)

> [!CAUTION]
> **OPERASI DESTRUKTIF:**
> 1. **Perintah Restore (`database/restore.js`)**: Menghapus dan menimpa skema tabel pada database aktif. Jangan pernah menjalankan perintah restore di lingkungan produksi tanpa backup mutakhir.
> 2. **Seeding Paksa (`--force`)**: Menjalankan `node database/seed-sop-data.js --force` akan mereset 8 modul SOP dasar ke konfigurasi awal pabrik dan menghapus langkah-langkah kustom yang ditambahkan teknisi IT. **Mode `--force` tidak boleh dimasukkan ke dalam script startup otomatis.**
> 3. **Penghapusan Kategori**: Menghapus kategori pada database yang memiliki panduan aktif akan memicu penolakan constraint relational foreign key.

---

## P. What is NOT Automatically Backed Up (Batasan Backup Otomatis)

Pencadangan menggunakan `npm run db:backup` mencakup seluruh data relasional PostgreSQL. Namun, demi transparansi teknis, hal-hal berikut **TIDAK** berada di dalam berkas backup database:

1. **Berkas Konfigurasi Host (`.env`)**:
   - Berisi kunci rahasia (`JWT_SECRET`, password database, API key Gemini). Berkas ini harus dicadangkan secara terpisah di vault kredensial IT RS yang aman.
2. **Source Code & Aset Aplikasi**:
   - Kode sumber aplikasi, gambar lokal (`/images/*`), dan skrip frontend disimpan di repositori Git, bukan di dalam database SQL.
3. **Off-Host & Cloud Redundancy**:
   - Script `database/backup.js` menulis berkas ke penyimpanan lokal disk server (`backups/`).
   - Tim IT RS Awal Bros bertanggung jawab menyalin berkas arsip `backups/` ke media penyimpanan terpisah (seperti Network Attached Storage / NAS internal RS, tape drive, atau server cadangan off-site).

---

## Q. Recommended Operational Backup Scheduling Approach (Jadwal Otomasi)

Untuk menjalankan backup secara berkala dan otomatis pada server produksi RS:

### 1. Menggunakan Linux Crontab (Rekomendasi)
Buka crontab dengan user aplikasi:
```bash
crontab -e
```
Tambahkan entri untuk backup harian setiap pukul 02:00 dini hari (waktu sepi operasional poliklinik):
```cron
# Eksekusi backup database setiap hari pukul 02:00 WIB
0 2 * * * cd /opt/rs-awal-bros-hardware-guidebook && /usr/bin/npm run db:backup >> /var/log/awal-bros-backup.log 2>&1
```

### 2. Menggunakan Windows Task Scheduler
Bila aplikasi di-host pada Windows Server:
1. Buka **Task Scheduler** -> **Create Basic Task**.
2. Beri nama: `RS_Awal_Bros_DB_Backup`.
3. Trigger: **Daily** pada pukul 02:00.
4. Action: **Start a program**:
   - Program/script: `cmd.exe`
   - Add arguments: `/c npm run db:backup`
   - Start in: `C:\inetpub\rs-awal-bros-hardware-guidebook` (sesuaikan direktori aplikasi).

---
*Dokumen ini merupakan standar operasional prosedur resmi M12 RS Awal Bros Botania.*
