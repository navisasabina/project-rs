// Real-time Search and Enter Key Filter with PostgreSQL Backend Integration
let searchAbortController = null;

/**
 * Execute search from UI input using backend PostgreSQL Full-Text Search API
 */
async function executeSearch() {
  const searchInput = document.getElementById('main-search-input');
  const term = (searchInput ? searchInput.value : '').trim();
  await filterCardsByBackendSearch(term);

  const section = document.getElementById('modules-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth' });
  }
}

function quickFilter(term) {
  const searchInput = document.getElementById('main-search-input');
  if (searchInput) {
    searchInput.value = term;
  }
  executeSearch();
}

function filterByDirectCategory(catKey) {
  switchTab('home');
  setTimeout(() => {
    quickFilter(catKey);
  }, 100);
}

/**
 * Filters DOM cards using backend PostgreSQL Search API with local fallback
 */
async function filterCardsByBackendSearch(query) {
  const trimmed = query ? query.trim() : '';

  // If query is empty, show all cards
  if (!trimmed) {
    filterCardsByKeyword('');
    return;
  }

  // Cancel any ongoing search request
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();

  try {
    const response = await fetch(`/api/v1/guides?search=${encodeURIComponent(trimmed)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: searchAbortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Search API returned status ${response.status}`);
    }

    const result = await response.json();
    if (!result.success || !Array.isArray(result.data)) {
      throw new Error('Search API returned invalid payload');
    }

    const matchedKeys = new Set(result.data.map(g => (g.key_code || '').toLowerCase()));
    const cards = document.querySelectorAll('.guide-card');
    const badge = document.getElementById('results-count-badge');
    const noResults = document.getElementById('no-results-state');
    let visibleCount = 0;

    cards.forEach(card => {
      const onclickAttr = card.getAttribute('onclick') || '';
      const match = onclickAttr.match(/openDedicatedSOP\(['"]([^'"]+)['"]\)/);
      const cardKey = match ? match[1].toLowerCase() : '';

      if (matchedKeys.has(cardKey)) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (badge) {
      badge.innerText = `Menampilkan ${visibleCount} Panduan`;
    }

    if (noResults) {
      if (visibleCount === 0) {
        noResults.classList.remove('hidden');
      } else {
        noResults.classList.add('hidden');
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    // Graceful fallback to client-side keywords if network/backend search encounters issues
    console.warn('[Search] Backend search failed or unavailable, falling back to local filter:', err.message);
    filterCardsByKeyword(trimmed);
  }
}

/**
 * Local DOM keyword filtering fallback
 */
function filterCardsByKeyword(query) {
  const cards = document.querySelectorAll('.guide-card');
  const badge = document.getElementById('results-count-badge');
  const noResults = document.getElementById('no-results-state');
  const q = (query || '').toLowerCase().trim();
  let visibleCount = 0;

  cards.forEach(card => {
    const keywords = (card.getAttribute('data-keywords') || '').toLowerCase();
    const textContent = card.innerText.toLowerCase();

    if (q === '' || keywords.includes(q) || textContent.includes(q)) {
      card.style.display = 'flex';
      visibleCount++;
    } else {
      card.style.display = 'none';
    }
  });

  if (badge) {
    badge.innerText = `Menampilkan ${visibleCount} Panduan`;
  }

  if (noResults) {
    if (visibleCount === 0) {
      noResults.classList.remove('hidden');
    } else {
      noResults.classList.add('hidden');
    }
  }
}

function resetSearch() {
  const searchInput = document.getElementById('main-search-input');
  if (searchInput) {
    searchInput.value = '';
  }
  filterCardsByKeyword('');
}
