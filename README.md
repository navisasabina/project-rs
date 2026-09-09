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

# Uji endpoint health check:
npm run test:health
```
Akses di browser melalui `http://localhost:3000` (User Portal) dan `http://localhost:3000/api/v1/health` (API Health Check).

### 2. Membuka Frontend Langsung (Static Fallback)
Buka file `index.html` langsung di browser modern, atau gunakan HTTP server sederhana:
```bash
python -m http.server 8000
```

