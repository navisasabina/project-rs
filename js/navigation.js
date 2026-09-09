let currentActiveSOPKey = "cache";

// Function to switch to the Dedicated SOP View
function openDedicatedSOP(sopKey) {
  const data = SOP_DATABASE[sopKey] || SOP_DATABASE['cache'];
  currentActiveSOPKey = data.key;

  // Populate SOP View DOM Elements
  document.getElementById('sop-category-badge').innerText = data.category;
  document.getElementById('sop-title').innerText = "Panduan: " + data.title;
  document.getElementById('sop-location').innerText = data.location;
  document.getElementById('sop-image').src = data.image;
  document.getElementById('sop-image').alt = data.title;

  // Populate Symptoms
  const symptomsListEl = document.getElementById('sop-symptoms-list');
  symptomsListEl.innerHTML = data.symptoms.map(s => `<li>${s}</li>`).join('');

  // Populate Steps
  document.getElementById('step-1-title').innerText = data.step1Title;
  document.getElementById('step-1-desc').innerHTML = data.step1Desc;
  document.getElementById('step-2-title').innerText = data.step2Title;
  document.getElementById('step-2-desc').innerHTML = data.step2Desc;
  document.getElementById('step-3-title').innerText = data.step3Title;
  document.getElementById('step-3-desc').innerHTML = data.step3Desc;
  document.getElementById('sop-security-note').innerText = data.securityNote;

  // Configure Direct WhatsApp Button
  const waText = encodeURIComponent(`Halo IT Support RS Awal Bros Botania, saya memerlukan bantuan teknisi untuk kendala: ${data.title} di lokasi unit: ${data.location}. Sudah mencoba SOP mandiri.`);
  const waLinkEl = document.getElementById('btn-sop-wa');
  if (waLinkEl) {
    waLinkEl.href = `https://wa.me/6281234567890?text=${waText}`;
  }

  // Switch View Content
  const views = document.querySelectorAll('.view-content');
  views.forEach(v => v.classList.remove('active'));

  const sopView = document.getElementById('view-sop');
  if (sopView) {
    sopView.classList.add('active');
  }

  // Update Nav Buttons
  const navTabs = document.querySelectorAll('.nav-tab-btn');
  navTabs.forEach(tab => {
    tab.classList.remove('border-[#0097A7]', 'text-[#0097A7]');
    tab.classList.add('border-transparent', 'text-slate-600');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Back to Main View
function backToHomeView() {
  switchTab('home');
}

// Ask Gemini from within current active SOP
function askGeminiFromCurrentSOP() {
  const data = SOP_DATABASE[currentActiveSOPKey] || SOP_DATABASE['cache'];
  openGeminiWithPrompt(data.prompt);
}

// SPA Tab Switcher
function switchTab(targetTab) {
  const views = document.querySelectorAll('.view-content');
  views.forEach(v => v.classList.remove('active'));

  const navTabs = document.querySelectorAll('.nav-tab-btn');
  navTabs.forEach(tab => {
    tab.classList.remove('border-[#0097A7]', 'text-[#0097A7]');
    tab.classList.add('border-transparent', 'text-slate-600');
  });

  const selectedView = document.getElementById('view-' + targetTab);
  if (selectedView) {
    selectedView.classList.add('active');
  }

  const activeBtn = document.getElementById('tab-btn-' + targetTab);
  if (activeBtn) {
    activeBtn.classList.remove('border-transparent', 'text-slate-600');
    activeBtn.classList.add('border-[#0097A7]', 'text-[#0097A7]');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}
