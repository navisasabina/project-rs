// Real-time Search and Enter Key Filter
function executeSearch() {
  const searchInput = document.getElementById('main-search-input');
  const term = (searchInput ? searchInput.value : '').trim().toLowerCase();
  filterCardsByKeyword(term);

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

function filterCardsByKeyword(query) {
  const cards = document.querySelectorAll('.guide-card');
  const badge = document.getElementById('results-count-badge');
  const noResults = document.getElementById('no-results-state');
  let visibleCount = 0;

  cards.forEach(card => {
    const keywords = (card.getAttribute('data-keywords') || '').toLowerCase();
    const textContent = card.innerText.toLowerCase();

    if (query === '' || keywords.includes(query) || textContent.includes(query)) {
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
