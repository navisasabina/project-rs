function openContactModal() {
  const modal = document.getElementById('contact-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeContactModal() {
  const modal = document.getElementById('contact-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

window.addEventListener('click', function(e) {
  const contactModal = document.getElementById('contact-modal');
  if (e.target === contactModal) {
    closeContactModal();
  }
});
