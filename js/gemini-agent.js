// Gemini AI Chat State & Logic
let isGeminiOpen = false;

function toggleGeminiChat() {
  const modal = document.getElementById('gemini-chat-modal');
  const fab = document.getElementById('gemini-floating-container');
  if (!modal) return;

  isGeminiOpen = !isGeminiOpen;
  if (isGeminiOpen) {
    modal.classList.remove('hidden');
    if (fab) fab.classList.add('hidden');
    setTimeout(() => {
      const input = document.getElementById('gemini-user-input');
      if (input) input.focus();
    }, 150);
  } else {
    modal.classList.add('hidden');
    if (fab) fab.classList.remove('hidden');
  }
}

function openGeminiChatWithFocus() {
  if (!isGeminiOpen) {
    toggleGeminiChat();
  }
  const input = document.getElementById('gemini-user-input');
  if (input) input.focus();
}

function clearGeminiInput() {
  const input = document.getElementById('gemini-user-input');
  if (input) {
    input.value = '';
    input.focus();
  }
}

function openGeminiWithPrompt(promptText) {
  if (!isGeminiOpen) {
    toggleGeminiChat();
  }
  const input = document.getElementById('gemini-user-input');
  if (input) {
    input.value = promptText;
  }
  processUserMessage(promptText);
}

function submitGeminiMessage(event) {
  event.preventDefault();
  const input = document.getElementById('gemini-user-input');
  if (!input) return;
  const userText = input.value.trim();
  if (!userText) return;
  processUserMessage(userText);
  input.value = '';
}

function resetGeminiConversation() {
  const container = document.getElementById('gemini-messages-box');
  if (!container) return;
  container.innerHTML = `
    <div class="flex gap-2.5">
      <div class="w-8 h-8 rounded-xl bg-hospital-navy text-[#00A3A6] flex-shrink-0 flex items-center justify-center shadow">
        <span class="material-symbols-outlined text-base">auto_awesome</span>
      </div>
      <div class="bg-white border border-slate-200 p-3.5 rounded-2xl rounded-tl-sm shadow-xs max-w-[88%] text-slate-800 space-y-2">
        <p class="font-bold text-hospital-navy flex items-center gap-1.5">
          Halo! Saya Gemini AI IT Support RS Awal Bros
        </p>
        <p class="leading-relaxed text-slate-600">
          Percakapan telah direset. Silakan sebutkan kendala perangkat Anda atau pilih salah satu menu cepat di atas.
        </p>
        <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
          <span>Respons Otomatis AI • RS Awal Bros</span>
          <span class="text-emerald-600 font-bold flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Siap Membantu</span>
        </div>
      </div>
    </div>
  `;
}

async function processUserMessage(message) {
  const container = document.getElementById('gemini-messages-box');
  if (!container) return;

  // 1. Render User Bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'flex justify-end';
  userBubble.innerHTML = `
    <div class="bg-hospital-navy text-white p-3 rounded-2xl rounded-tr-sm shadow-sm max-w-[85%] text-xs leading-relaxed">
      <p>${escapeHtml(message)}</p>
      <span class="block text-[9px] text-teal-200 text-right mt-1">Staf Medis / Anda</span>
    </div>
  `;
  container.appendChild(userBubble);
  container.scrollTop = container.scrollHeight;

  // 2. Render Typing Indicator
  const typingId = 'typing-' + Date.now();
  const typingBubble = document.createElement('div');
  typingBubble.id = typingId;
  typingBubble.className = 'flex gap-2.5';
  typingBubble.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-hospital-navy text-[#00A3A6] flex-shrink-0 flex items-center justify-center shadow">
      <span class="material-symbols-outlined text-base animate-spin">sync</span>
    </div>
    <div class="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm shadow-xs text-slate-500 flex items-center gap-2">
      <span class="font-medium text-xs">Gemini menganalisa SOP RS Awal Bros...</span>
      <div class="flex gap-1">
        <span class="w-1.5 h-1.5 bg-[#0097A7] rounded-full typing-dot"></span>
        <span class="w-1.5 h-1.5 bg-[#0097A7] rounded-full typing-dot"></span>
        <span class="w-1.5 h-1.5 bg-[#0097A7] rounded-full typing-dot"></span>
      </div>
    </div>
  `;
  container.appendChild(typingBubble);
  container.scrollTop = container.scrollHeight;

  // 3. AI Intelligent Response Generation via Backend Proxy
  let responseObj = null;

  try {
    const res = await fetch('/api/v1/ai/diagnose', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ message: message }),
    });

    if (res.status === 429) {
      const errJson = await res.json().catch(() => ({}));
      responseObj = {
        title: 'Batas Permintaan Tercapai (Rate Limit)',
        category: 'Keamanan Sistem',
        intro: errJson?.error?.message || 'Terlalu banyak permintaan diagnosa AI. Silakan tunggu beberapa saat sebelum mencoba kembali.',
        steps: [
          'Tunggu 1–2 menit sebelum mengirimkan pertanyaan baru.',
          'Bila membutuhkan bantuan segera, hubungi IT Helpdesk melalui sambungan telepon darurat.'
        ],
        note: 'Rate limiting diterapkan untuk menjaga stabilitas infrastruktur rumah sakit.',
        source: 'RATE_LIMITED'
      };
    } else if (res.ok) {
      const json = await res.json();
      if (json.success && json.data) {
        responseObj = json.data;
      }
    }
  } catch (netErr) {
    console.warn('[Gemini AI] Backend endpoint unreachable, using client-side fallback:', netErr.message);
  }

  // Graceful fallback to client-side SOP generation if backend is unavailable or failed
  if (!responseObj) {
    responseObj = generateSOPResponse(message);
  }

  // Remove typing indicator
  const typingEl = document.getElementById(typingId);
  if (typingEl) typingEl.remove();

  // Render AI Response Bubble
  const aiBubble = document.createElement('div');
  aiBubble.className = 'flex gap-2.5 animate-in fade-in duration-200';
  aiBubble.innerHTML = `
    <div class="w-8 h-8 rounded-xl bg-hospital-navy text-[#00A3A6] flex-shrink-0 flex items-center justify-center shadow">
      <span class="material-symbols-outlined text-base">auto_awesome</span>
    </div>
    <div class="bg-white border border-slate-200 p-3.5 rounded-2xl rounded-tl-sm shadow-sm max-w-[88%] text-slate-800 space-y-2.5">
      <div class="flex items-center justify-between border-b border-slate-100 pb-1.5">
        <span class="font-bold text-hospital-navy flex items-center gap-1">
          <span class="material-symbols-outlined text-sm text-[#0097A7]">verified</span> ${escapeHtml(responseObj.title || 'Diagnosis SOP IT')}
        </span>
        <span class="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 text-[#0097A7] font-bold uppercase">${escapeHtml(responseObj.category || 'IT Support')}</span>
      </div>
      <p class="text-slate-600 leading-relaxed">${escapeHtml(responseObj.intro || '')}</p>
      <div class="bg-slate-50 border border-slate-200/80 rounded-xl p-2.5 space-y-1.5">
        <div class="font-bold text-[11px] text-slate-700">Langkah Mandiri Sesuai SOP:</div>
        <ol class="list-decimal list-inside space-y-1 text-slate-600 text-[11px] leading-relaxed">
          ${(responseObj.steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>
      ${responseObj.note ? `
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-900 leading-tight">
          <strong>Catatan Penting:</strong> ${escapeHtml(responseObj.note)}
        </div>
      ` : ''}
      <div class="pt-1.5 flex flex-wrap items-center gap-2">
        <a href="https://wa.me/6281234567890?text=Halo%20IT%20RS%20Awal%20Bros,%20butuh%20bantuan%20teknisi%20untuk:%20${encodeURIComponent(message)}" target="_blank" class="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1.5 rounded-lg text-[10px] shadow transition">
          <svg class="w-3 h-3 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
          Panggil Teknisi via WA
        </a>
        <span class="text-[10px] text-slate-400">atau PABX <strong>Ext 104</strong> (Emergency)</span>
      </div>
    </div>
  `;
  container.appendChild(aiBubble);
  container.scrollTop = container.scrollHeight;
}

function generateSOPResponse(query) {
  const q = query.toLowerCase();

  if (q.includes('printer') || q.includes('kertas') || q.includes('etiket') || q.includes('resep') || q.includes('stiker') || q.includes('blink')) {
    return {
      title: "Diagnosis Printer Resep & Etiket Farmasi",
      category: "Hardware Printer",
      intro: "Indikator lampu berkedip merah (blinking) menandakan kertas tersangkut (paper jam), cover belum tertutup rapat, atau sensor gap terhalang serpihan label.",
      steps: [
        "Buka penutup printer dengan menarik kedua tuas samping secara bersamaan.",
        "Angkat roll stiker etiket, bersihkan serpihan kertas di atas sensor optik hitam bagian tengah.",
        "Pasang kembali roll dengan jalur lurus dan tekan cover hingga terdengar bunyi 'KLIK' ganda.",
        "Tekan tombol FEED 1 kali untuk kalibrasi otomatis hingga keluar tepat 1 label dan lampu berubah hijau."
      ],
      note: "Jika lampu merah tetap menyala setelah kalibrasi, periksa kabel adaptor daya dan hubungi tim IT untuk penggantian roll head."
    };
  }

  if (q.includes('lan') || q.includes('jaringan') || q.includes('internet') || q.includes('kabel') || q.includes('bola dunia') || q.includes('offline') || q.includes('disconnect') || q.includes('rj45')) {
    return {
      title: "Diagnosis Koneksi Jaringan & Kabel LAN",
      category: "Network / LAN",
      intro: "Tanda silang merah atau ikon bola dunia menunjukkan komputer terputus dari switch room RS Awal Bros.",
      steps: [
        "Periksa kabel biru RJ45 di belakang PC, cabut lalu pasang kembali hingga berbunyi 'klik'.",
        "Pastikan lampu LED kecil (warna oranye/hijau) di samping port LAN CPU berkedip aktif.",
        "Periksa ujung kabel satunya yang terpasang pada port data dinding (Wallplate).",
        "Bila koneksi tetap mati, catat nomor port dinding (contoh: Port 14 ICU) dan hubungi IT."
      ],
      note: "Jangan menukar kabel LAN ke soket Telepon analog karena dapat merusak controller jaringan CPU."
    };
  }

  if (q.includes('monitor') || q.includes('signal') || q.includes('layar') || q.includes('display') || q.includes('blank') || q.includes('bergaris') || q.includes('vga') || q.includes('hdmi')) {
    return {
      title: "Diagnosis Monitor 'No Signal' / Layar Blank",
      category: "Layar Display",
      intro: "Jika CPU menyala namun monitor menampilkan 'No Signal', kendala umumnya terjadi pada kelonggaran kabel display atau pilihan input mode.",
      steps: [
        "Kencangkan kedua sekrup pengunci kabel VGA/HDMI di belakang monitor dan di casing CPU.",
        "Pastikan kabel adaptor daya monitor terpasang kuat dan lampu power menyala biru/putih.",
        "Tekan tombol 'Source' di frame monitor, alihkan pilihan ke 'HDMI 1' atau 'Auto Detect'.",
        "Tekan kombinasi tombol Windows + Ctrl + Shift + B pada keyboard untuk merefresh driver grafis."
      ],
      note: "Hindari menyenggol kabel di belakang meja dokter saat memindahkan berkas rekam medis tebal."
    };
  }

  if (q.includes('mini pc') || q.includes('onlogic') || q.includes('bracket') || q.includes('dokter')) {
    return {
      title: "Diagnosis Mini PC Bracket Meja Dokter",
      category: "Mini Workstation",
      intro: "Mini PC di ruang poli dipasang pada bracket bawah meja dan rentan tersenggol kaki dokter atau pasien.",
      steps: [
        "Periksa lampu LED indikator biru pada bagian depan sasis Mini PC OnLogic.",
        "Raba soket daya bundar 19V di bagian belakang, pastikan adaptor terpasang kencang.",
        "Cek colokan adaptor di terminal stopkontak bawah meja praktek pastikan saklar merah aktif.",
        "Jika mati total, tahan tombol daya depan selama 8 detik untuk melakukan hard power reset."
      ],
      note: "Jangan meletakkan tas atau dokumen basah di atas ventilasi mini PC agar sirkulasi pendingin tidak tertutup."
    };
  }

  return {
    title: "Panduan Cepat IT Support RS Awal Bros",
    category: "SOP Umum RS",
    intro: `Saya memahami kendala Anda terkait "${query}". Berikut panduan diagnostik awal sesuai protokol IT RS Awal Bros:`,
    steps: [
      "Lakukan restart standar: Matikan perangkat melalui sistem (atau tombol daya), tunggu 15 detik, lalu nyalakan kembali.",
      "Periksa sambungan kabel fisik (kabel daya listrik, kabel LAN RJ45, dan kabel display).",
      "Jika kendala terkait software SIMRS lemot, bersihkan riwayat cache browser dengan menekan Ctrl + Shift + Del.",
      "Bila dalam 3 menit sistem belum normal, segera eskalasikan ke teknisi on-site kami."
    ],
    note: "Untuk unit darurat (ICU/IGD/Kamar Operasi), tim IT standby 24 jam via Ext 104 untuk respons cepat Code Blue IT."
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}
