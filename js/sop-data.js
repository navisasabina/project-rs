// Full Dedicated SOP Master Data for all 8 Cards
const SOP_DATABASE = {
  cache: {
    key: "cache",
    title: "Komputer Lambat / Cache Menumpuk",
    category: "Aplikasi & Browser",
    location: "Poliklinik, Farmasi & Administrasi",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1WxAVvsJjJsR2NV0jbAUXR_15wLdHrqbupyJcHJy2ilJo1AU2ptAajEgSd8Ay3d1QeOdg_jZ2-zqKMUehPu-FVLVLqs4nP7QGSyNcAfsLoMtxew4NTCQLimfIXKuYyJrRf-vVwAMK6mLt6umn9iSn7J9GWf0A9M65ZIiN1rv51fgI66Bh0KR2G6MB37pHhilCclhOxHdJTGnA1DTXyIBNoyJNAwHKvxjur7W6qvq23XHqyk2rwMFknUSiU",
    prompt: "Komputer Lambat dan Cache Menumpuk di Poliklinik / Farmasi",
    symptoms: [
      "Aplikasi rekam medis atau SIMRS berputar lama (loading terus-menerus) saat klik simpan resep.",
      "Browser Google Chrome / Microsoft Edge muncul peringatan 'Page Unresponsive' atau hang.",
      "Terdapat puluhan tab browser terbuka selama berminggu-minggu tanpa pernah di-restart."
    ],
    step1Title: "Langkah 1: Tutup Tab Berlebih & Periksa Memori",
    step1Desc: "Tutup tab browser yang sudah tidak aktif atau selesai melayani pasien sebelumnya. Periksa apakah ada unduhan file besar di latar belakang browser.",
    step2Title: "Langkah 2: Bersihkan Cache & Cookies Browser",
    step2Desc: "Pada browser, tekan tombol kombinasi <strong>Ctrl + Shift + Del</strong>. Pilih rentang waktu <strong>All time (Semua Waktu)</strong>, centang opsi <em>'Cookies and other site data'</em> serta <em>'Cached images and files'</em>, lalu klik tombol <strong>Clear data</strong>.",
    step3Title: "Langkah 3: Restart Browser & Lakukan Relog SIMRS",
    step3Desc: "Tutup seluruh jendela browser sepenuhnya, tunggu 5 detik, kemudian buka kembali. Lakukan Login ulang ke sistem SIMRS Rumah Sakit dan verifikasi bahwa akses form resep kini lancar kembali.",
    securityNote: "Jangan pernah mencentang opsi 'Passwords' saat membersihkan cache agar kata sandi tersimpan Anda tidak terhapus."
  },
  lan: {
    key: "lan",
    title: "Internet Tidak Terhubung / LAN Terlepas",
    category: "Jaringan & Port",
    location: "Nurse Station, Ruang Dialisis & Kantor",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1Ub-AGGvJtLQwy4LLjKItC41otPDWt-eYdpSiuQM3teR1Fn1L7NtgG89AvR84D2G56R1o_jyLjUDPK80li5lhUQHXi2haD-xAZ3rf252bvngEXD1W6rALSft-rEPwd2iuEOcIP6EVC2lmnTAnnuhW57gJpdmpxzCMtxRF5xFzXtWhLbm-ZeREm1yvhsz-VINyOYRwfeEKPUl5khfc9sEt7Ia_XfZESSXfCs35GES9Bb1AhyciS5jypbqYU",
    prompt: "Koneksi LAN Disconnected / Internet Tidak Terhubung di Nurse Station",
    symptoms: [
      "Ikon bola dunia (Globe) atau silang merah pada pojok kanan bawah taskbar Windows.",
      "SIMRS menampilkan pesan 'Koneksi ke Server Terputus (Network Error)'.",
      "Lampu indikator di samping port kabel LAN belakang komputer tidak menyala atau padam."
    ],
    step1Title: "Langkah 1: Periksa Fisik Kabel LAN di Belakang CPU",
    step1Desc: "Periksa kabel LAN biru RJ45 di bagian belakang PC. Tekan klip pengunci, cabut secara perlahan, lalu colokkan kembali dengan dorongan mantap hingga terdengar bunyi <strong>'KLIK'</strong>.",
    step2Title: "Langkah 2: Periksa Wall Outlet Dinding / Meja Station",
    step2Desc: "Periksa ujung kabel satunya yang menancap pada pelat port data dinding (Wallplate). Pastikan kabel tertancap rapat dan tidak terjepit roda kursi atau troli medis.",
    step3Title: "Langkah 3: Verifikasi Lampu LED Port & Akses Jaringan",
    step3Desc: "Amati lampu LED kecil pada port LAN CPU: pastikan lampu oranye/hijau berkedip (blinking). Buka browser lalu coba akses portal internal RS untuk memastikan koneksi aktif.",
    securityNote: "Dilarang memindahkan kabel LAN ke port telepon analog warna abu-abu karena dapat merusak controller kartu jaringan PC."
  },
  printer: {
    key: "printer",
    title: "Printer Tidak Berfungsi / Resep Macet",
    category: "Farmasi & Kasir",
    location: "Kasir, Screening & Farmasi",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1VCLKt6zfl2VoA9GNVKkbY_jGAZK0_BijnrEhBhzfMrNbkZToVP0Ztqg23PSYmNxYhSRuNvfjNessWpVwX7bFUaFWuYBnRJwHpF5FY76Z4VWl0jvs9BJDctu7w7ncZFQyQTl9BNYewO5y7WFZRIa39dxmb5YORN-_Wlr7eTHcWgIcA_beZot5qELlXIQL7aFhQeuFSWWh1Xah9fTFKbdi0IlWC_fYbGqxJX5qpSx5ert1ER0He6TrGJ050",
    prompt: "Printer Thermal Resep & Etiket Blink Merah / Kertas Macet",
    symptoms: [
      "Lampu indikator LED pada printer thermal berkedip merah (blinking red / error).",
      "Kertas stiker etiket obat tidak keluar (paper jam) atau mencetak terpotong di tengah label.",
      "Dokumen resep di antrean kasir tertahan di status 'Print Spooler / Pending'."
    ],
    step1Title: "Langkah 1: Buka Cover Printer & Bersihkan Paper Jam",
    step1Desc: "Matikan saklar power printer (posisi 0). Tekan tuas pembuka penutup di sisi kanan/kiri untuk membuka cover atas. Tarik kertas atau sisa serpihan etiket yang tersangkut secara perlahan.",
    step2Title: "Langkah 2: Pasang Ulang Roll Kertas & Kalibrasi Gap Sensor",
    step2Desc: "Posisikan gulungan label stiker menghadap ke atas pada roll holder. Tarik ujung kertas melewati sensor hitam tengah, lalu tutup cover printer hingga terdengar bunyi 'KLIK' di kedua sisi.",
    step3Title: "Langkah 3: Nyalakan Printer & Tekan Tombol FEED",
    step3Desc: "Nyalakan saklar power (posisi 1). Tekan tombol <strong>FEED</strong> sekali; pastikan printer mengeluarkan tepat 1 lembar label etiket dan lampu LED berubah warna menjadi hijau stabil.",
    securityNote: "Gunakan stiker etiket thermal resmi bertanda RS Awal Bros agar sisa lem tidak mengotori roll printhead mekanis."
  },
  power: {
    key: "power",
    title: "PC / Komputer Tidak Menyala (Mati Total)",
    category: "Hardware PC",
    location: "Customer Care, NICU & Meja Perawat",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1VW7tPkFD4mOCtpaskCNDCRNLCwk1RuyOvqydy5wmI3Hh4O63NHsZ8eLs0K-NPd2qFex-lOZhtTSStIIvlIzlemamEK4G-xtHQYbGkQR7kLpBR4zmNNnreWiYcmllUAWKrPUMLSmtuNvi9motgM3KZGi3sA7zgzn6SqVxZNM2cUXPzpJLqZoPckHXn8rY9XvaHgMZM7gCLjVtKSTkKl-2UfKKRtOOwrlXCGw2V-TSZG9e3B059U6d0kbKQ",
    prompt: "PC Komputer Mati Total di Customer Care / Meja Perawat",
    symptoms: [
      "Layar monitor gelap dan lampu indikator tombol daya pada CPU sama sekali tidak menyala.",
      "Tidak ada suara kipas pendingin berputar di bagian dalam casing komputer.",
      "Komputer tiba-tiba mati setelah pemindahan kabel stopkontak atau goncangan troli."
    ],
    step1Title: "Langkah 1: Periksa Kabel Power 3-Lubang & Stopkontak",
    step1Desc: "Raba dan dorong kuat kabel listrik hitam 3 lubang (kabel AC) di bagian belakang CPU. Pastikan colokan stopkontak dinding atau terminal UPS menyala dan terpasang kokoh.",
    step2Title: "Langkah 2: Periksa Saklar Daya UPS / Saklar Belakang PSU",
    step2Desc: "Pastikan tombol power pada unit UPS cadangan baterai menyala dengan lampu hijau (bukan kedip merah/bip panjang). Jika ada saklar I/O di belakang CPU, pastikan di posisi 'I' (ON).",
    step3Title: "Langkah 3: Lakukan Hard Power Drain 10 Detik",
    step3Desc: "Lepas kabel power belakang CPU, tekan dan tahan tombol daya depan selama 10 detik untuk menguras arus sisa kapasitor, pasang kembali kabel power, lalu tekan tombol Power 1 kali.",
    securityNote: "Jika tercium bau hangus atau UPS mengeluarkan bunyi peringatan nada konstan, segera cabut saklar dan hubungi IT Siaga."
  },
  monitor: {
    key: "monitor",
    title: "Monitor Tidak Ada Sinyal (No Signal / Blank)",
    category: "Layar Display",
    location: "Pendaftaran, Kasir & Ruang Operasi OK",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1Vg5mpgGfdX0Gs5aZCkm7lPCUk_JlhKqP-URFq_RSoy2IkkW3W8aeoXYN2X0sYnZUxuViH77SLJtEUng4tQOrjvRSa2i6k3auCDQSHlT3J53eVdqG-0yBgoWSFbIyRFyaVPhKdp-LYJAvkweWOstyyj0Tx8it5Eo8SNpj5utfAsLHcetgaOgVVqaeJgzvHMnBDyYbgFhmJw_4YCMwekl6BjcLjsvmMeFSBd-4fc4LtD5IJtXQyONFRTyg",
    prompt: "Monitor Menampilkan 'No Signal' / Layar Hitam di Ruang Operasi / Pendaftaran",
    symptoms: [
      "CPU komputer menyala dan kipas terdengar berputar, namun layar monitor menampilkan teks 'No Signal' atau 'Check Signal Cable'.",
      "Lampu indikator power monitor menyala kuning/oranye (standby/sleep mode).",
      "Tampilan layar berkedip-kedip saat kabel display di bawah meja tersenggol."
    ],
    step1Title: "Langkah 1: Kencangkan Kabel HDMI / VGA di Kedua Ujung",
    step1Desc: "Periksa kabel video (HDMI tebal atau VGA biru). Putar dan kencangkan kedua sekrup pengunci di belakang monitor dan di bagian kartu display CPU.",
    step2Title: "Langkah 2: Periksa Sumber Input (Source Selection)",
    step2Desc: "Tekan tombol <strong>Source / Input</strong> di panel bawah atau belakang monitor. Alihkan mode dari VGA ke HDMI 1 atau pilih <strong>'Auto Detect'</strong>.",
    step3Title: "Langkah 3: Tes Bangunkan Layar dengan Keyboard",
    step3Desc: "Tekan kombinasi tombol <strong>Windows + Ctrl + Shift + B</strong> untuk merestart driver kartu grafis Windows. Layar akan berkedip 1 kali dan tampilan desktop akan normal kembali.",
    securityNote: "Jangan menarik paksa dongle konverter HDMI-to-VGA karena soket pin tembaga tipis mudah patah di port motherboard."
  },
  mouse: {
    key: "mouse",
    title: "Keyboard / Mouse Bermasalah (Macet / Kursor Hilang)",
    category: "Aksesoris USB",
    location: "Screening E & Nurse Station",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1WQSZVeJrS2KZNnsz7qW5sU5-_Bi2dJsDdVdlR8ZuE23TbrGWqMQweJFYw3MfvEmiLYDW7s6aQsFSri-yetD1Zhzuko-9sJ2sNuzalWZbT7SICGC2YaJttp2vnaWKx8lg_NMU78vp6HUNb-2UKJBQoZQ2C7vZBLafOIl94n3Wb-Unogu1_4wc03VZkAjxqCWLYT_iQog6I_DyBzmqX1VIWuqzJ3EiIzr6TtDZsG-L431hSbJgiVkYlNJ_I",
    prompt: "Keyboard dan Mouse Macet Tidak Bisa Mengetik di Nurse Station",
    symptoms: [
      "Kursor mouse tidak bergerak sama sekali atau melompat-lompat di layar monitor.",
      "Ketik tombol huruf pada keyboard tidak muncul di formulir input pasien.",
      "Lampu optik merah/biru pada bagian bawah mouse mati."
    ],
    step1Title: "Langkah 1: Pindahkan Colokan USB ke Panel Belakang CPU",
    step1Desc: "Cabut konektor USB mouse/keyboard dari port depan CPU. Tancapkan langsung ke salah satu port USB di <strong>panel BELAKANG CPU</strong> yang memiliki daya listrik lebih stabil.",
    step2Title: "Langkah 2: Bersihkan Sensor Optik & Gunakan Mousepad Bersih",
    step2Desc: "Periksa sensor optik di bagian bawah mouse, tiup bila terdapat debu atau rambut. Hindari menggunakan mouse di atas kaca polos tanpa alas mousepad.",
    step3Title: "Langkah 3: Periksa Tombol NumLock & Re-deteksi Windows",
    step3Desc: "Pada keyboard, tekan tombol <strong>NumLock</strong> atau <strong>CapsLock</strong>. Jika lampu indikator NumLock menyala merespons, berarti keyboard telah siap digunakan kembali.",
    securityNote: "Untuk perangkat nirkabel (wireless), ganti 2 buah baterai baru ukuran AAA di slot kompartemen bawah keyboard."
  },
  minipc: {
    key: "minipc",
    title: "Mini PC Ruang Periksa (Bracket Bawah Meja)",
    category: "Meja Dokter",
    location: "Klinik Spesialis, Poli Kecantikan & Periksa",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1WAHW5N946kPEoKQ5mfz8K5JRqFTtfl0_ciB1-BDEPy3XF0M5XBlZ0EJ6G67-zd6E9NZRsVPv1BWsUxg7g5x8Rw2p4utHYqOpodM2_IPVfdY7AXLzQ5XaFrQt-NuJzh3VT32t8IirJOa7OD-kg2oH03a7cJ9OLx34i4peycOSFRHhrczIoCkrcevr6XeJBwUNoxGCEgyvQVBBs_lHOeiGlcffWoDsVeS65LXwGMLTf359m92D3f1N_LYD8",
    prompt: "Mini PC Dokter Spesialis di Bawah Meja Mati / Adaptor Kendor",
    symptoms: [
      "Mini PC berukuran kecil yang terpasang di bawah meja dokter spesialis tidak merespons saat tombol daya ditekan.",
      "Lampu LED power biru kecil pada sasis Mini PC OnLogic padam.",
      "Adaptor daya hitam 19V di bawah meja terlepas karena tersenggol kaki atau kabel ketarik."
    ],
    step1Title: "Langkah 1: Periksa Soket Daya Adaptor 19V",
    step1Desc: "Raba bagian belakang Mini PC pada bracket meja. Pastikan jack bulat adaptor listrik 19V tertancap rapat dan tidak kendor dari lubang soket daya.",
    step2Title: "Langkah 2: Periksa Stopkontak Terminal Bawah Meja Praktek",
    step2Desc: "Periksa sambungan kotak terminal listrik di bawah meja dokter. Pastikan adaptor adaptor menancap kokoh dan saklar terminal berwarna merah dalam keadaan menyala.",
    step3Title: "Langkah 3: Tekan Tombol Power Depan Selama 8 Detik",
    step3Desc: "Tekan dan tahan tombol daya di panel depan Mini PC selama 8 detik untuk melakukan hard-reboot. Lepaskan tombol, lalu tekan sekali lagi hingga lampu indikator biru menyala stabil.",
    securityNote: "Dilarang menumpuk berkas rekam medis tebal atau tas di atas Mini PC agar kisi ventilasi pendingin udara tidak tertutup."
  },
  cctv: {
    key: "cctv",
    title: "Kamera CCTV Tidak Terdeteksi (Offline)",
    category: "Keamanan Fisik",
    location: "Koridor Ruang Rawat, VIP & Area Parkir",
    image: "https://lh3.googleusercontent.com/aida/AEtjO1UNqFYrVuoaqqlJOV0wxYjiZAitPhLBLPJMYN2kP93jZzDKVaWvpDMbQbNnOJKzgBB9ShYGjsaP-kdnaWgS79i-El3dHnJhKvLSbdjBXN4A7WmRqm7Z5Sdp8IBkkNa4ViZm-Xey4ucuHrl-O-_X3jt9mQsh3IWoKU3qpnAHJL3Np2d2hqOKK5_EsQCDFADhEaIms8zmFepAFL6L_yI_6MmlzRh4q3-znWiIsdpcI6KHki5YbH6olmOFA9M",
    prompt: "Kamera CCTV Koridor Pasien Offline Tidak Terdeteksi di Layar Monitor Keamanan",
    symptoms: [
      "Layar monitor di pos sekuriti menampilkan kotak hitam bertuliskan 'Camera Offline' atau 'No Video'.",
      "Lampu LED inframerah pada kamera dome plafon mati saat kondisi minim cahaya.",
      "Koneksi IP kamera putus setelah terjadi perbaikan kabel plafon atau pekerjaan maintenance."
    ],
    step1Title: "Langkah 1: Pengecekan Visual Fisik Kamera Plafon",
    step1Desc: "Amati fisik kamera dome di plafon koridor. Pastikan kabel LAN biru yang terhubung ke dome kamera terpasang rapi dan tidak kendur atau sobek.",
    step2Title: "Langkah 2: Catat Nomor Label & Lokasi Kamera",
    step2Desc: "Catat nomor identifikasi kamera yang tertera pada bingkai stiker (misal: 'CAM-LT3-WEST-02') dan waktu perkiraan mulai terputus.",
    step3Title: "Langkah 3: Laporkan ke IT Server Room untuk Reset Port PoE",
    step3Desc: "Teknisi IT akan melakukan restart port PoE (Power over Ethernet) secara jarak jauh melalui managed switch di ruang server pusat.",
    securityNote: "DILARANG memutar atau menarik rumah kamera secara manual karena dapat merusak motor gimbal presisi dan merusak kalibrasi sudut pantau."
  }
};
