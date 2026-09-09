// Application initialization & event listener binding
document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('main-search-input');

  if (searchInput) {
    searchInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        executeSearch();
      }
    });
  }
});
