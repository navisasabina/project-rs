let currentActiveSOPKey = "cache";

// Helper to get active SOP data (Runtime store from API with fallback to static SOP_DATABASE)
function getSOPRecord(key) {
  const runtimeStore = (typeof window !== 'undefined' && window.ACTIVE_SOP_DATA) ? window.ACTIVE_SOP_DATA : null;
  const fallbackStore = (typeof window !== 'undefined' && window.SOP_DATABASE) ? window.SOP_DATABASE : (typeof SOP_DATABASE !== 'undefined' ? SOP_DATABASE : {});
  
  if (runtimeStore && runtimeStore[key]) {
    return runtimeStore[key];
  }
  if (fallbackStore && fallbackStore[key]) {
    return fallbackStore[key];
  }
  return (runtimeStore && runtimeStore['cache']) || fallbackStore['cache'] || {};
}

// Function to switch to the Dedicated SOP View
function openDedicatedSOP(sopKey) {
  const data = getSOPRecord(sopKey);
  currentActiveSOPKey = data.key || sopKey;

  const defaultImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'%3E%3Crect width='800' height='400' fill='%23002541'/%3E%3Ctext x='50%25' y='46%25' dominant-baseline='middle' text-anchor='middle' fill='%230097A7' font-family='sans-serif' font-size='28' font-weight='bold'%3ERS AWAL BROS%3C/text%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' fill='%2394A3B8' font-family='sans-serif' font-size='16'%3EPanduan IT Support%3C/text%3E%3C/svg%3E";

  // Populate SOP View DOM Elements
  const catBadge = document.getElementById('sop-category-badge');
  if (catBadge) catBadge.innerText = data.category || '';

  const titleEl = document.getElementById('sop-title');
  if (titleEl) titleEl.innerText = "Panduan: " + (data.title || '');

  const locEl = document.getElementById('sop-location');
  if (locEl) locEl.innerText = data.location || '';

  const imgEl = document.getElementById('sop-image');
  if (imgEl) {
    imgEl.src = data.image || defaultImg;
    imgEl.alt = data.title || '';
    imgEl.onerror = function() {
      this.onerror = null;
      this.src = defaultImg;
    };
  }

  // Populate Symptoms
  const symptomsListEl = document.getElementById('sop-symptoms-list');
  if (symptomsListEl) {
    const symptoms = Array.isArray(data.symptoms) ? data.symptoms : [];
    symptomsListEl.innerHTML = symptoms.map(s => `<li>${s}</li>`).join('');
  }

  // Populate Steps
  const step1TitleEl = document.getElementById('step-1-title');
  if (step1TitleEl) step1TitleEl.innerText = data.step1Title || '';
  const step1DescEl = document.getElementById('step-1-desc');
  if (step1DescEl) step1DescEl.innerHTML = data.step1Desc || '';

  const step2TitleEl = document.getElementById('step-2-title');
  if (step2TitleEl) {
    step2TitleEl.innerText = data.step2Title || '';
    const step2Card = step2TitleEl.closest('.flex');
    if (step2Card) {
      step2Card.style.display = (data.step2Title || data.step2Desc) ? 'flex' : 'none';
    }
  }
  const step2DescEl = document.getElementById('step-2-desc');
  if (step2DescEl) step2DescEl.innerHTML = data.step2Desc || '';

  const step3TitleEl = document.getElementById('step-3-title');
  if (step3TitleEl) {
    step3TitleEl.innerText = data.step3Title || '';
    const step3Card = step3TitleEl.closest('.flex');
    if (step3Card) {
      step3Card.style.display = (data.step3Title || data.step3Desc) ? 'flex' : 'none';
    }
  }
  const step3DescEl = document.getElementById('step-3-desc');
  if (step3DescEl) step3DescEl.innerHTML = data.step3Desc || '';

  const noteEl = document.getElementById('sop-security-note');
  if (noteEl) noteEl.innerText = data.securityNote || '';

  // Configure Direct WhatsApp Button
  const waText = encodeURIComponent(`Halo IT Helpdesk RS Awal Bros (Pak Bayu Firman), saya memerlukan bantuan teknisi untuk kendala: ${data.title} di lokasi unit: ${data.location}. Sudah mencoba SOP mandiri.`);
  const waLinkEl = document.getElementById('btn-sop-wa');
  if (waLinkEl) {
    waLinkEl.href = `https://wa.me/6282217305162?text=${waText}`;
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
  const data = getSOPRecord(currentActiveSOPKey);
  openGeminiWithPrompt(data.prompt || data.title || '');
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
