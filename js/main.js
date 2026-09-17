// Global active SOP runtime store
if (typeof window !== 'undefined') {
  window.ACTIVE_SOP_DATA = window.SOP_DATABASE || {};
  window.KNOWLEDGE_BASE_SOURCE = 'INITIAL';
}

/**
 * Escapes HTML characters for safe template interpolation
 */
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escapes characters for JavaScript attribute strings
 */
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;');
}

/**
 * Renders homepage cards dynamically into #cards-grid
 * Preserves exact existing UI structure, classes, and interactions.
 * Ensures newly published guides appear automatically and isolates DRAFT/ARCHIVED.
 * @param {object|Array} sopData
 */
function renderHomepageCards(sopData) {
  if (typeof document === 'undefined') return;
  const grid = document.getElementById('cards-grid');
  if (!grid) return;

  const defaultImg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400' viewBox='0 0 800 400'%3E%3Crect width='800' height='400' fill='%23002541'/%3E%3Ctext x='50%25' y='46%25' dominant-baseline='middle' text-anchor='middle' fill='%230097A7' font-family='sans-serif' font-size='28' font-weight='bold'%3ERS AWAL BROS%3C/text%3E%3Ctext x='50%25' y='58%25' dominant-baseline='middle' text-anchor='middle' fill='%2394A3B8' font-family='sans-serif' font-size='16'%3EPanduan IT Support%3C/text%3E%3C/svg%3E";

  const rawList = Array.isArray(sopData) ? sopData : Object.values(sopData || {});

  // Defensive isolation: Only show PUBLISHED guides (exclude DRAFT and ARCHIVED)
  const publishedGuides = rawList.filter(guide => {
    if (!guide || !guide.key) return false;
    if (guide.status && guide.status !== 'PUBLISHED') return false;
    return true;
  });

  if (publishedGuides.length === 0) return;

  const cardsHtml = publishedGuides.map(guide => {
    const symptomsStr = Array.isArray(guide.symptoms) ? guide.symptoms.join(' ') : (guide.symptoms || '');
    const keywords = [
      guide.keywords || '',
      guide.title || '',
      guide.category || '',
      guide.location || '',
      symptomsStr,
      guide.key || ''
    ].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();

    const title = escapeHTML(guide.title || '');
    const category = escapeHTML(guide.category || 'IT Support');
    const location = escapeHTML(guide.location || 'RS Awal Bros');
    const key = escapeAttr(guide.key);
    const imgSrc = guide.image ? escapeHTML(guide.image) : defaultImg;

    return `
      <div class="guide-card bg-white rounded-2xl overflow-hidden shadow-xs border border-slate-200 hover:border-[#03B1C0] hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between" data-keywords="${escapeHTML(keywords)}" onclick="openDedicatedSOP('${key}')">
        <div>
          <div class="relative h-48 bg-slate-100 overflow-hidden">
            <img alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" src="${imgSrc}" onerror="this.onerror=null; this.src='${defaultImg}';"/>
            <span class="absolute top-3 left-3 bg-[#03B1C0] text-white text-xs font-semibold px-2.5 py-1 rounded-md shadow-xs">${category}</span>
          </div>
          <div class="p-4">
            <h3 class="font-bold text-sm sm:text-base text-slate-900 group-hover:text-[#03B1C0] transition-colors leading-snug">${title}</h3>
            <p class="text-xs text-slate-500 mt-1">${location}</p>
          </div>
        </div>
        <div class="px-4 pb-4 pt-1 border-t border-slate-100 flex items-center justify-between">
          <span class="text-xs font-bold text-[#03B1C0] group-hover:text-[#0298a5] flex items-center gap-1">
            Lihat Detail SOP <span class="transition-transform group-hover:translate-x-1">→</span>
          </span>
          <span class="material-symbols-outlined text-[#03B1C0] text-xl transition-transform group-hover:translate-x-0.5">chevron_right</span>
        </div>
      </div>
    `.trim();
  }).join('\n');

  grid.innerHTML = cardsHtml;

  const badge = document.getElementById('results-count-badge');
  if (badge) {
    badge.innerText = `Menampilkan ${publishedGuides.length} Panduan`;
  }

  // If there is an active search filter in the input, apply it immediately
  const searchInput = document.getElementById('main-search-input');
  if (searchInput && searchInput.value.trim() && typeof filterCardsByBackendSearch === 'function') {
    filterCardsByBackendSearch(searchInput.value.trim());
  }
}

// Application initialization & event listener binding
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async function() {
    // 1. Initialize search enter key binding
    const searchInput = document.getElementById('main-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          executeSearch();
        }
      });
    }

    // 2. Asynchronously load Knowledge Base from PostgreSQL API with graceful fallback
    try {
      if (typeof window !== 'undefined' && typeof window.KB_API !== 'undefined' && typeof window.KB_API.loadKnowledgeBase === 'function') {
        const kbResult = await window.KB_API.loadKnowledgeBase(window.SOP_DATABASE);
        window.ACTIVE_SOP_DATA = kbResult.data || window.SOP_DATABASE;
        window.KNOWLEDGE_BASE_SOURCE = kbResult.source; // 'API' or 'FALLBACK'
        console.log(`[RS Awal Bros KB] Knowledge Base active source: ${kbResult.source} (${Object.keys(window.ACTIVE_SOP_DATA).length} guides loaded)`);
      } else if (typeof window !== 'undefined') {
        window.ACTIVE_SOP_DATA = window.SOP_DATABASE || {};
        window.KNOWLEDGE_BASE_SOURCE = 'FALLBACK';
      }
    } catch (err) {
      console.warn('[RS Awal Bros KB] Error initializing knowledge base, using local fallback:', err);
      if (typeof window !== 'undefined') {
        window.ACTIVE_SOP_DATA = window.SOP_DATABASE || {};
        window.KNOWLEDGE_BASE_SOURCE = 'FALLBACK';
      }
    }

    // 3. Render cards dynamically from active knowledge base
    if (typeof window !== 'undefined') {
      renderHomepageCards(window.ACTIVE_SOP_DATA);
    }
  });
}

// Expose globally for browser usage
if (typeof window !== 'undefined') {
  window.renderHomepageCards = renderHomepageCards;
}

// Support Node.js testing environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderHomepageCards,
    escapeHTML,
    escapeAttr,
  };
}

