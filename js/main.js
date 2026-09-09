// Global active SOP runtime store
window.ACTIVE_SOP_DATA = (typeof window !== 'undefined' && window.SOP_DATABASE) ? window.SOP_DATABASE : {};
window.KNOWLEDGE_BASE_SOURCE = 'INITIAL';

// Application initialization & event listener binding
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
    if (typeof window.KB_API !== 'undefined' && typeof window.KB_API.loadKnowledgeBase === 'function') {
      const kbResult = await window.KB_API.loadKnowledgeBase(window.SOP_DATABASE);
      window.ACTIVE_SOP_DATA = kbResult.data || window.SOP_DATABASE;
      window.KNOWLEDGE_BASE_SOURCE = kbResult.source; // 'API' or 'FALLBACK'
      console.log(`[RS Awal Bros KB] Knowledge Base active source: ${kbResult.source} (${Object.keys(window.ACTIVE_SOP_DATA).length} guides loaded)`);
    } else {
      window.ACTIVE_SOP_DATA = window.SOP_DATABASE || {};
      window.KNOWLEDGE_BASE_SOURCE = 'FALLBACK';
    }
  } catch (err) {
    console.warn('[RS Awal Bros KB] Error initializing knowledge base, using local fallback:', err);
    window.ACTIVE_SOP_DATA = window.SOP_DATABASE || {};
    window.KNOWLEDGE_BASE_SOURCE = 'FALLBACK';
  }
});

