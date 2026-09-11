/**
 * Admin Dashboard Controller — RS Awal Bros IT Knowledge Base
 * 
 * Manages:
 * - Session verification & Role-based Access Control (RBAC)
 * - Navigation tabs (Overview, Guides, Categories)
 * - Guides listing, filtering (status, category, search), and detail preview
 * - Guide authoring & Dynamic Steps Builder (Create/Edit)
 * - Guide lifecycle transitions (DRAFT -> PUBLISHED -> ARCHIVED)
 * - Category listing, creation, editing, and status toggles
 * - Modals, confirmation dialogs, and toast notifications
 */

(function (window, document) {
  'use strict';

  // Application State
  const state = {
    currentUser: null,
    categories: [],
    guides: [],
    filteredGuides: [],
    users: [],
    userFilter: {
      search: '',
      role: 'ALL',
      status: 'ALL',
    },
    auditLogs: [],
    auditFilter: {
      search: '',
      action: 'ALL',
    },
    activeTab: 'overview',
    guideFilter: {
      status: 'ALL',
      category: 'ALL',
      search: '',
    },
    editingGuideId: null,
    editingCategoryId: null,
    pendingAction: null, // For confirmation dialog: { type, id, title, execute }
  };

  /* ==========================================================================
     1. INITIALIZATION & SESSION GUARD
     ========================================================================== */

  document.addEventListener('DOMContentLoaded', async () => {
    initUnauthorizedListener();
    await verifySessionAndBoot();
  });

  function initUnauthorizedListener() {
    window.addEventListener('admin:unauthorized', () => {
      showToast('Sesi Anda telah kedaluwarsa. Mengarahkan ke halaman login...', 'error');
      setTimeout(() => {
        window.location.replace('/admin/login');
      }, 1200);
    });
  }

  async function verifySessionAndBoot() {
    const loadingOverlay = document.getElementById('dashboard-loading-overlay');
    try {
      const user = await window.AdminAPI.auth.getProfile();
      if (!user || !user.id) {
        throw new Error('Unauthenticated');
      }

      state.currentUser = user;
      renderUserProfile(user);
      applyRBAC(user.role);

      // Fetch initial data concurrently
      await Promise.all([
        loadCategories(),
        loadGuides(),
        loadUsers(),
      ]);

      renderOverviewKPIs();

      // Hide loading skeleton
      if (loadingOverlay) {
        loadingOverlay.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => loadingOverlay.classList.add('hidden'), 300);
      }
    } catch (err) {
      console.warn('[AdminDashboard] Authentication verification failed:', err);
      window.location.replace('/admin/login');
    }
  }

  function renderUserProfile(user) {
    const nameEl = document.getElementById('user-full-name');
    const roleBadgeEl = document.getElementById('user-role-badge');
    const avatarEl = document.getElementById('user-avatar-initial');

    if (nameEl) nameEl.textContent = user.full_name;
    if (avatarEl) avatarEl.textContent = user.full_name ? user.full_name.charAt(0).toUpperCase() : 'U';

    if (roleBadgeEl) {
      let roleClass = 'bg-slate-700 text-slate-200 border-slate-600';
      let roleLabel = user.role;

      if (user.role === 'ADMIN') {
        roleClass = 'bg-red-500/10 text-red-400 border-red-500/30';
        roleLabel = 'ADMINISTRATOR';
      } else if (user.role === 'IT_MANAGER') {
        roleClass = 'bg-[#0097A7]/10 text-cyan-400 border-[#0097A7]/30';
        roleLabel = 'IT MANAGER';
      } else if (user.role === 'IT_SUPPORT') {
        roleClass = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
        roleLabel = 'IT SUPPORT (READ-ONLY)';
      }

      roleBadgeEl.className = `px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${roleClass}`;
      roleBadgeEl.textContent = roleLabel;
    }
  }

  function applyRBAC(role) {
    const isReadOnly = role === 'IT_SUPPORT';

    // Elements that require mutation permissions (ADMIN / IT_MANAGER)
    const mutationElements = document.querySelectorAll('.rbac-mutation');
    mutationElements.forEach((el) => {
      if (isReadOnly) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
      }
    });

    const readOnlyNotice = document.getElementById('read-only-banner');
    if (readOnlyNotice) {
      if (isReadOnly) {
        readOnlyNotice.classList.remove('hidden');
      } else {
        readOnlyNotice.classList.add('hidden');
      }
    }
  }

  /* ==========================================================================
     2. NAVIGATION & TABS
     ========================================================================== */

  window.switchAdminTab = function (tabName) {
    state.activeTab = tabName;

    // Update Tab Buttons UI
    document.querySelectorAll('.admin-nav-btn').forEach((btn) => {
      btn.classList.remove('border-[#0097A7]', 'text-[#0097A7]', 'bg-slate-800');
      btn.classList.add('border-transparent', 'text-slate-400');
    });

    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) {
      activeBtn.classList.remove('border-transparent', 'text-slate-400');
      activeBtn.classList.add('border-[#0097A7]', 'text-[#0097A7]', 'bg-slate-800');
    }

    // Update Tab Panels View
    document.querySelectorAll('.admin-view-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });

    const targetPanel = document.getElementById(`view-${tabName}`);
    if (targetPanel) {
      targetPanel.classList.remove('hidden');
    }

    if (tabName === 'overview') {
      renderOverviewKPIs();
    } else if (tabName === 'guides') {
      renderGuidesTable();
    } else if (tabName === 'categories') {
      renderCategoriesList();
    } else if (tabName === 'users') {
      loadUsers().then(() => renderUsersTable());
    } else if (tabName === 'audit') {
      loadAuditLogs();
    }
  };

  /* ==========================================================================
     3. DATA FETCHING & STATE
     ========================================================================== */

  async function loadCategories() {
    try {
      const categories = await window.AdminAPI.categories.getAll();
      state.categories = categories || [];
      populateCategoryDropdowns();
      renderCategoriesList();
    } catch (err) {
      showToast(err.message || 'Gagal memuat kategori.', 'error');
    }
  }

  async function loadGuides() {
    try {
      const guides = await window.AdminAPI.guides.getAll({
        status: state.guideFilter.status,
        category: state.guideFilter.category,
      });
      state.guides = guides || [];
      applyGuideFilters();
    } catch (err) {
      showToast(err.message || 'Gagal memuat panduan SOP.', 'error');
    }
  }

  function populateCategoryDropdowns() {
    // 1. Filter dropdown in Guides Tab
    const filterCatSelect = document.getElementById('guide-filter-category');
    if (filterCatSelect) {
      const currentVal = filterCatSelect.value;
      filterCatSelect.innerHTML = '<option value="ALL">Semua Kategori</option>';
      state.categories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.slug;
        opt.textContent = `${cat.name} (${cat.guide_count || 0})`;
        filterCatSelect.appendChild(opt);
      });
      filterCatSelect.value = currentVal || 'ALL';
    }

    // 2. Category select in Guide Form Modal
    const formCatSelect = document.getElementById('guide-form-category');
    if (formCatSelect) {
      formCatSelect.innerHTML = '<option value="" disabled selected>Pilih Kategori Hardware</option>';
      state.categories.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = `${cat.name} ${!cat.is_active ? '(Non-aktif)' : ''}`;
        formCatSelect.appendChild(opt);
      });
    }
  }

  /* ==========================================================================
     4. OVERVIEW DASHBOARD (KPIs & SUMMARY)
     ========================================================================== */

  function renderOverviewKPIs() {
    const totalGuides = state.guides.length;
    const publishedGuides = state.guides.filter((g) => g.status === 'PUBLISHED').length;
    const draftGuides = state.guides.filter((g) => g.status === 'DRAFT').length;
    const archivedGuides = state.guides.filter((g) => g.status === 'ARCHIVED').length;
    const totalCategories = state.categories.length;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setVal('kpi-total-guides', totalGuides);
    setVal('kpi-published-guides', publishedGuides);
    setVal('kpi-draft-guides', draftGuides);
    setVal('kpi-archived-guides', archivedGuides);
    setVal('kpi-total-categories', totalCategories);

    // Render recent 5 guides
    const recentContainer = document.getElementById('overview-recent-guides');
    if (!recentContainer) return;

    if (state.guides.length === 0) {
      recentContainer.innerHTML = `
        <tr>
          <td colspan="5" class="py-8 text-center text-slate-500 text-xs">Belum ada panduan terdaftar dalam sistem.</td>
        </tr>
      `;
      return;
    }

    const recent = [...state.guides].slice(0, 5);
    recentContainer.innerHTML = recent.map((guide) => `
      <tr class="hover:bg-slate-800/40 transition-colors border-b border-slate-800/60 text-xs">
        <td class="py-3 px-4 font-semibold text-slate-200">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full ${getStatusDotClass(guide.status)}"></span>
            <span>${escapeHTML(guide.title)}</span>
          </div>
          <span class="text-[10px] text-slate-500 font-mono font-normal block mt-0.5">key: ${escapeHTML(guide.key_code)}</span>
        </td>
        <td class="py-3 px-4 text-slate-400">
          <span class="inline-flex items-center gap-1">
            <span class="material-symbols-outlined text-sm text-cyan-400">${escapeHTML(guide.category ? guide.category.icon : 'folder')}</span>
            <span>${escapeHTML(guide.category ? guide.category.name : '-')}</span>
          </span>
        </td>
        <td class="py-3 px-4 text-slate-400 font-mono">${guide.step_count || 0} Langkah</td>
        <td class="py-3 px-4">${renderStatusBadge(guide.status)}</td>
        <td class="py-3 px-4 text-right">
          <button onclick="viewGuideDetail('${guide.id}')" class="text-cyan-400 hover:text-cyan-300 font-medium px-2 py-1 rounded hover:bg-cyan-500/10 transition-colors">
            Lihat Detail
          </button>
        </td>
      </tr>
    `).join('');
  }

  /* ==========================================================================
     5. KNOWLEDGE BASE GUIDES MANAGEMENT
     ========================================================================== */

  window.handleGuideSearch = function (e) {
    state.guideFilter.search = e.target.value.trim().toLowerCase();
    applyGuideFilters();
  };

  window.filterGuidesByStatus = function (status) {
    state.guideFilter.status = status;

    // Update filter buttons
    document.querySelectorAll('.guide-status-filter-btn').forEach((btn) => {
      btn.classList.remove('bg-[#0097A7]', 'text-white', 'font-semibold');
      btn.classList.add('bg-slate-800', 'text-slate-400');
    });

    const activeBtn = document.getElementById(`status-filter-${status.toLowerCase()}`);
    if (activeBtn) {
      activeBtn.classList.remove('bg-slate-800', 'text-slate-400');
      activeBtn.classList.add('bg-[#0097A7]', 'text-white', 'font-semibold');
    }

    loadGuides();
  };

  window.handleGuideCategoryFilter = function (e) {
    state.guideFilter.category = e.target.value;
    loadGuides();
  };

  function applyGuideFilters() {
    const q = state.guideFilter.search;
    if (!q) {
      state.filteredGuides = [...state.guides];
    } else {
      state.filteredGuides = state.guides.filter((guide) => {
        const titleMatch = (guide.title || '').toLowerCase().includes(q);
        const keyMatch = (guide.key_code || '').toLowerCase().includes(q);
        const locMatch = (guide.location_scope || '').toLowerCase().includes(q);
        const catMatch = (guide.category?.name || '').toLowerCase().includes(q);
        const kwMatch = (guide.keywords || '').toLowerCase().includes(q);
        return titleMatch || keyMatch || locMatch || catMatch || kwMatch;
      });
    }

    renderGuidesTable();
  }

  function renderGuidesTable() {
    const tbody = document.getElementById('guides-table-body');
    const countBadge = document.getElementById('guides-filtered-count');
    if (!tbody) return;

    if (countBadge) {
      countBadge.textContent = `${state.filteredGuides.length} Panduan`;
    }

    if (state.filteredGuides.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-12 text-center text-slate-400">
            <div class="max-w-xs mx-auto space-y-2">
              <span class="material-symbols-outlined text-4xl text-slate-600">search_off</span>
              <p class="text-sm font-medium text-slate-300">Tidak ada panduan troubleshooting yang cocok.</p>
              <p class="text-xs text-slate-500">Coba ubah kata kunci pencarian atau sesuaikan filter status.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const isReadOnly = state.currentUser?.role === 'IT_SUPPORT';

    tbody.innerHTML = state.filteredGuides.map((guide) => `
      <tr class="hover:bg-slate-800/50 transition-colors border-b border-slate-800/60 text-xs">
        <!-- Title & Key -->
        <td class="py-3.5 px-4 font-semibold text-slate-200">
          <div class="flex items-start gap-2.5">
            <div class="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-cyan-400 mt-0.5">
              <span class="material-symbols-outlined text-base">${escapeHTML(guide.category ? guide.category.icon : 'devices')}</span>
            </div>
            <div>
              <span class="font-bold text-slate-100 text-[13px] block hover:text-cyan-400 cursor-pointer" onclick="viewGuideDetail('${guide.id}')">
                ${escapeHTML(guide.title)}
              </span>
              <div class="flex items-center gap-2 mt-1 text-[11px] text-slate-400 font-normal">
                <span class="font-mono bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-700/60 text-slate-400">
                  ${escapeHTML(guide.key_code)}
                </span>
                <span>&bull;</span>
                <span class="text-slate-400">${escapeHTML(guide.location_scope || '-')}</span>
              </div>
            </div>
          </div>
        </td>

        <!-- Category -->
        <td class="py-3.5 px-4 text-slate-300">
          <span class="font-medium text-slate-300">${escapeHTML(guide.category ? guide.category.name : '-')}</span>
        </td>

        <!-- Status -->
        <td class="py-3.5 px-4">
          ${renderStatusBadge(guide.status)}
        </td>

        <!-- Steps -->
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center gap-1.5 font-mono text-slate-300 font-medium">
            <span class="material-symbols-outlined text-xs text-slate-500">format_list_numbered</span>
            <span>${guide.step_count || 0} Langkah</span>
          </span>
        </td>

        <!-- Author & Time -->
        <td class="py-3.5 px-4 text-slate-400 text-[11px]">
          <div>${escapeHTML(guide.author ? guide.author.full_name : 'Sistem')}</div>
          <div class="text-slate-500 text-[10px] mt-0.5">${formatDate(guide.updated_at || guide.created_at)}</div>
        </td>

        <!-- Actions -->
        <td class="py-3.5 px-4 text-right">
          <div class="inline-flex items-center gap-1 justify-end">
            <!-- View Detail (All Roles) -->
            <button
              onclick="viewGuideDetail('${guide.id}')"
              class="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Lihat Detail Lengkap"
            >
              <span class="material-symbols-outlined text-lg">visibility</span>
            </button>

            ${!isReadOnly ? `
              <!-- Edit Guide (ADMIN & IT_MANAGER) -->
              <button
                onclick="openEditGuideModal('${guide.id}')"
                class="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="Edit Panduan & Langkah"
              >
                <span class="material-symbols-outlined text-lg">edit</span>
              </button>

              <!-- Lifecycle Actions -->
              ${guide.status === 'DRAFT' ? `
                <button
                  onclick="confirmStatusChange('${guide.id}', 'PUBLISHED', '${escapeHTML(guide.title)}')"
                  class="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-colors"
                  title="Publikasikan ke Portal Pengguna"
                >
                  <span class="material-symbols-outlined text-lg">publish</span>
                </button>
                <button
                  onclick="confirmStatusChange('${guide.id}', 'ARCHIVED', '${escapeHTML(guide.title)}')"
                  class="p-1.5 text-slate-400 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                  title="Arsipkan Panduan"
                >
                  <span class="material-symbols-outlined text-lg">archive</span>
                </button>
              ` : ''}

              ${guide.status === 'PUBLISHED' ? `
                <button
                  onclick="confirmStatusChange('${guide.id}', 'ARCHIVED', '${escapeHTML(guide.title)}')"
                  class="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors"
                  title="Arsipkan (Tarik dari Portal Publik)"
                >
                  <span class="material-symbols-outlined text-lg">archive</span>
                </button>
              ` : ''}

              ${guide.status === 'ARCHIVED' ? `
                <span class="px-2 py-0.5 text-[10px] text-slate-500 italic">Arsip</span>
              ` : ''}

              <!-- Delete Guide (ADMIN & IT_MANAGER) -->
              <button
                onclick="confirmDeleteGuide('${guide.id}', '${escapeHTML(guide.title)}')"
                class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Hapus Panduan Permanen"
              >
                <span class="material-symbols-outlined text-lg">delete</span>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }

  /* ==========================================================================
     6. GUIDE DETAIL PREVIEW MODAL
     ========================================================================== */

  window.viewGuideDetail = async function (guideId) {
    const modal = document.getElementById('guide-detail-modal');
    const content = document.getElementById('guide-detail-modal-content');
    if (!modal || !content) return;

    modal.classList.remove('hidden');
    content.innerHTML = `
      <div class="py-16 text-center text-slate-400">
        <span class="animate-spin inline-block w-8 h-8 border-2 border-[#0097A7] border-t-transparent rounded-full mb-3"></span>
        <p class="text-xs">Memuat detail panduan...</p>
      </div>
    `;

    try {
      const guide = await window.AdminAPI.guides.getById(guideId);

      const symptomsList = Array.isArray(guide.symptoms) && guide.symptoms.length > 0
        ? guide.symptoms.map((s) => `<li class="flex items-start gap-2"><span class="text-cyan-400 mt-0.5">•</span><span>${escapeHTML(s)}</span></li>`).join('')
        : '<li class="text-slate-500 italic">Tidak ada rincian gejala khusus.</li>';

      const stepsList = Array.isArray(guide.steps) && guide.steps.length > 0
        ? guide.steps.map((step) => `
          <div class="flex items-start gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#002541] to-[#0097A7] text-white flex items-center justify-center font-bold text-sm shrink-0 shadow">
              ${step.step_number}
            </div>
            <div class="flex-1">
              <h5 class="text-sm font-bold text-slate-200">${escapeHTML(step.title)}</h5>
              <p class="text-xs text-slate-400 mt-1 leading-relaxed">${escapeHTML(step.instruction)}</p>
            </div>
          </div>
        `).join('')
        : '<p class="text-xs text-slate-500 italic">Panduan ini belum memiliki langkah-langkah tersusun.</p>';

      content.innerHTML = `
        <div class="space-y-6">
          <!-- Header info banner -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div class="flex items-center gap-2 mb-1.5">
                ${renderStatusBadge(guide.status)}
                <span class="text-xs font-mono bg-slate-800 px-2 py-0.5 rounded text-slate-400 border border-slate-700">
                  key: ${escapeHTML(guide.key_code)}
                </span>
              </div>
              <h3 class="text-lg sm:text-xl font-bold font-brand text-white">${escapeHTML(guide.title)}</h3>
              <p class="text-xs text-slate-400 mt-1">
                Kategori: <strong class="text-slate-300">${escapeHTML(guide.category ? guide.category.name : '-')}</strong> &bull;
                Lokasi: <strong class="text-slate-300">${escapeHTML(guide.location_scope || '-')}</strong> &bull;
                Estimasi: <strong class="text-slate-300">${escapeHTML(guide.estimated_time || '2 - 4 Menit')}</strong>
              </p>
            </div>

            ${guide.image_url ? `
              <div class="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border border-slate-700 shrink-0 bg-slate-900">
                <img src="${escapeHTML(guide.image_url)}" alt="${escapeHTML(guide.title)}" class="w-full h-full object-cover"/>
              </div>
            ` : ''}
          </div>

          <!-- Security Note (Hospital Standard) -->
          ${guide.security_note ? `
            <div class="p-4 rounded-xl bg-red-950/40 border border-red-800/60 text-xs text-red-200 flex items-start gap-3">
              <span class="material-symbols-outlined text-red-400 text-lg shrink-0 mt-0.5">verified_user</span>
              <div>
                <strong class="font-bold text-red-300 block mb-0.5">Catatan Keselamatan & Kepatuhan Pasien:</strong>
                <p class="leading-relaxed">${escapeHTML(guide.security_note)}</p>
              </div>
            </div>
          ` : ''}

          <!-- Symptoms & Causes Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div class="p-4 rounded-xl bg-slate-900/40 border border-slate-800">
              <h4 class="font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm text-cyan-400">troubleshoot</span>
                <span>Gejala Masalah Terdeteksi</span>
              </h4>
              <ul class="space-y-1.5 text-slate-400">
                ${symptomsList}
              </ul>
            </div>

            <div class="p-4 rounded-xl bg-slate-900/40 border border-slate-800">
              <h4 class="font-bold text-slate-300 mb-2 flex items-center gap-1.5">
                <span class="material-symbols-outlined text-sm text-amber-400">help_outline</span>
                <span>Kemungkinan Penyebab</span>
              </h4>
              <p class="text-slate-400 leading-relaxed">${escapeHTML(guide.possible_causes || 'Belum diisi.')}</p>
            </div>
          </div>

          <!-- Step by step troubleshooting -->
          <div>
            <h4 class="font-bold text-sm text-slate-200 mb-3 flex items-center gap-2">
              <span class="material-symbols-outlined text-base text-[#0097A7]">format_list_numbered</span>
              <span>Prosedur Langkah Penanganan (SOP Standar)</span>
            </h4>
            <div class="space-y-2.5">
              ${stepsList}
            </div>
          </div>

          <!-- Metadata info -->
          <div class="pt-4 border-t border-slate-800 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>Dibuat oleh: <strong class="text-slate-400">${escapeHTML(guide.author ? guide.author.full_name : 'Sistem')}</strong></span>
            <span>Terakhir diperbarui: <strong class="text-slate-400">${formatDate(guide.updated_at || guide.created_at)}</strong></span>
          </div>
        </div>
      `;
    } catch (err) {
      content.innerHTML = `
        <div class="p-6 text-center text-red-400 text-xs">
          <p class="font-bold">Gagal memuat detail panduan.</p>
          <p class="mt-1 text-slate-400">${escapeHTML(err.message)}</p>
        </div>
      `;
    }
  };

  window.closeGuideDetailModal = function () {
    const modal = document.getElementById('guide-detail-modal');
    if (modal) modal.classList.add('hidden');
  };

  /* ==========================================================================
     7. GUIDE CREATE & EDIT MODAL (WITH DYNAMIC STEP BUILDER)
     ========================================================================== */

  window.openCreateGuideModal = function () {
    state.editingGuideId = null;
    const modal = document.getElementById('guide-form-modal');
    const title = document.getElementById('guide-form-modal-title');
    const form = document.getElementById('guide-form');

    if (title) title.textContent = 'Tambah Panduan Troubleshooting Baru';
    if (form) form.reset();

    // Reset steps to 1 default step
    renderStepBuilder([
      { title: '', instruction: '' }
    ]);

    // Set default status to DRAFT
    const statusSelect = document.getElementById('guide-form-status');
    if (statusSelect) statusSelect.value = 'DRAFT';

    populateCategoryDropdowns();
    if (modal) modal.classList.remove('hidden');
  };

  window.openEditGuideModal = async function (guideId) {
    state.editingGuideId = guideId;
    const modal = document.getElementById('guide-form-modal');
    const title = document.getElementById('guide-form-modal-title');
    if (title) title.textContent = 'Edit Panduan Troubleshooting';

    populateCategoryDropdowns();

    try {
      const guide = await window.AdminAPI.guides.getById(guideId);

      // Populate basic inputs
      document.getElementById('guide-form-title').value = guide.title || '';
      document.getElementById('guide-form-category').value = guide.category ? guide.category.id : '';
      document.getElementById('guide-form-keycode').value = guide.key_code || '';
      document.getElementById('guide-form-location').value = guide.location_scope || '';
      document.getElementById('guide-form-image').value = guide.image_url || '';
      document.getElementById('guide-form-time').value = guide.estimated_time || '2 - 4 Menit';
      document.getElementById('guide-form-security').value = guide.security_note || '';
      document.getElementById('guide-form-causes').value = guide.possible_causes || '';
      document.getElementById('guide-form-prompt').value = guide.prompt_shortcut || '';
      document.getElementById('guide-form-keywords').value = guide.keywords || '';

      const symptomsStr = Array.isArray(guide.symptoms) ? guide.symptoms.join('\n') : '';
      document.getElementById('guide-form-symptoms').value = symptomsStr;

      // Status selector (for edit, status is modified via dedicated lifecycle buttons or preserved)
      const statusSelect = document.getElementById('guide-form-status');
      if (statusSelect) {
        statusSelect.value = guide.status || 'DRAFT';
      }

      // Populate steps
      const stepsToRender = Array.isArray(guide.steps) && guide.steps.length > 0
        ? guide.steps.map((s) => ({ title: s.title, instruction: s.instruction }))
        : [{ title: '', instruction: '' }];

      renderStepBuilder(stepsToRender);

      if (modal) modal.classList.remove('hidden');
    } catch (err) {
      showToast(err.message || 'Gagal mengambil data panduan untuk diedit.', 'error');
    }
  };

  window.closeGuideFormModal = function () {
    const modal = document.getElementById('guide-form-modal');
    if (modal) modal.classList.add('hidden');
  };

  // Dynamic Steps Builder Helpers
  function renderStepBuilder(steps = []) {
    const container = document.getElementById('steps-builder-container');
    if (!container) return;

    container.innerHTML = steps.map((step, idx) => `
      <div class="step-item p-4 rounded-xl bg-slate-900/80 border border-slate-800 relative group space-y-3" data-step-index="${idx}">
        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
          <span class="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
            <span class="w-5 h-5 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[11px] font-mono">
              ${idx + 1}
            </span>
            <span>Langkah ${idx + 1}</span>
          </span>
          <div class="flex items-center gap-1">
            <button
              type="button"
              onclick="moveStep(${idx}, -1)"
              class="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors ${idx === 0 ? 'opacity-30 pointer-events-none' : ''}"
              title="Pindah ke Atas"
            >
              <span class="material-symbols-outlined text-sm">arrow_upward</span>
            </button>
            <button
              type="button"
              onclick="moveStep(${idx}, 1)"
              class="p-1 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors ${idx === steps.length - 1 ? 'opacity-30 pointer-events-none' : ''}"
              title="Pindah ke Bawah"
            >
              <span class="material-symbols-outlined text-sm">arrow_downward</span>
            </button>
            <button
              type="button"
              onclick="removeStep(${idx})"
              class="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors ${steps.length <= 1 ? 'opacity-30 pointer-events-none' : ''}"
              title="Hapus Langkah"
            >
              <span class="material-symbols-outlined text-sm">delete</span>
            </button>
          </div>
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-slate-400 mb-1">Judul Langkah</label>
          <input
            type="text"
            class="step-title-input w-full px-3 py-1.5 bg-slate-950/60 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-[#0097A7]"
            placeholder="Contoh: Periksa Lampu LED Indikator Daya"
            value="${escapeHTML(step.title || '')}"
            required
          />
        </div>

        <div>
          <label class="block text-[11px] font-semibold text-slate-400 mb-1">Instruksi Detail Langkah</label>
          <textarea
            rows="2"
            class="step-instruction-input w-full px-3 py-1.5 bg-slate-950/60 border border-slate-700/80 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-[#0097A7]"
            placeholder="Jelaskan tindakan spesifik yang harus dilakukan staf di ruangan..."
            required
          >${escapeHTML(step.instruction || '')}</textarea>
        </div>
      </div>
    `).join('');
  }

  function getStepBuilderValues() {
    const items = document.querySelectorAll('.step-item');
    const steps = [];
    items.forEach((item, idx) => {
      const title = item.querySelector('.step-title-input')?.value.trim() || '';
      const instruction = item.querySelector('.step-instruction-input')?.value.trim() || '';
      steps.push({
        step_number: idx + 1,
        title,
        instruction,
      });
    });
    return steps;
  }

  window.addStepToBuilder = function () {
    const currentSteps = getStepBuilderValues();
    currentSteps.push({ title: '', instruction: '' });
    renderStepBuilder(currentSteps);
  };

  window.removeStep = function (index) {
    const currentSteps = getStepBuilderValues();
    if (currentSteps.length <= 1) return;
    currentSteps.splice(index, 1);
    renderStepBuilder(currentSteps);
  };

  window.moveStep = function (index, direction) {
    const currentSteps = getStepBuilderValues();
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= currentSteps.length) return;

    const temp = currentSteps[index];
    currentSteps[index] = currentSteps[newIdx];
    currentSteps[newIdx] = temp;

    renderStepBuilder(currentSteps);
  };

  window.handleGuideFormSubmit = async function (event) {
    event.preventDefault();
    const submitBtn = document.getElementById('guide-form-submit-btn');

    // Collect fields
    const title = document.getElementById('guide-form-title').value.trim();
    const category_id = document.getElementById('guide-form-category').value;
    const key_code = document.getElementById('guide-form-keycode').value.trim();
    const location_scope = document.getElementById('guide-form-location').value.trim();
    const image_url = document.getElementById('guide-form-image').value.trim();
    const estimated_time = document.getElementById('guide-form-time').value.trim();
    const security_note = document.getElementById('guide-form-security').value.trim();
    const possible_causes = document.getElementById('guide-form-causes').value.trim();
    const prompt_shortcut = document.getElementById('guide-form-prompt').value.trim();
    const keywords = document.getElementById('guide-form-keywords').value.trim();
    const status = document.getElementById('guide-form-status').value || 'DRAFT';

    const symptomsRaw = document.getElementById('guide-form-symptoms').value;
    const symptoms = symptomsRaw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const steps = getStepBuilderValues();

    if (steps.some((s) => !s.title || !s.instruction)) {
      showToast('Setiap langkah harus memiliki Judul dan Instruksi yang lengkap.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      if (state.editingGuideId) {
        // Edit Mode: Update guide metadata + update steps
        await window.AdminAPI.guides.update(state.editingGuideId, {
          title,
          category_id,
          key_code: key_code || undefined,
          location_scope,
          image_url,
          estimated_time,
          security_note,
          possible_causes,
          prompt_shortcut,
          keywords,
          symptoms,
        });

        // Update steps via PUT
        if (steps.length > 0) {
          await window.AdminAPI.guides.updateSteps(state.editingGuideId, steps);
        }

        showToast('Panduan troubleshooting berhasil diperbarui!', 'success');
      } else {
        // Create Mode
        await window.AdminAPI.guides.create({
          title,
          category_id,
          key_code: key_code || undefined,
          location_scope,
          image_url,
          estimated_time,
          security_note,
          possible_causes,
          prompt_shortcut,
          keywords,
          symptoms,
          status,
          steps,
        });

        showToast('Panduan troubleshooting baru berhasil ditambahkan!', 'success');
      }

      closeGuideFormModal();
      await loadGuides();
      renderOverviewKPIs();
    } catch (err) {
      showToast(err.message || 'Gagal menyimpan panduan.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };

  /* ==========================================================================
     8. GUIDE LIFECYCLE MANAGEMENT (PUBLISH / ARCHIVE)
     ========================================================================== */

  window.confirmStatusChange = function (guideId, targetStatus, guideTitle) {
    const isPublish = targetStatus === 'PUBLISHED';
    const actionName = isPublish ? 'Publikasikan' : 'Arsipkan';

    const message = isPublish
      ? `Apakah Anda yakin ingin mempublikasikan panduan "${guideTitle}"? Panduan ini akan langsung aktif dan dapat dilihat oleh staf medis di Portal Pengguna.`
      : `Apakah Anda yakin ingin mengarsipkan panduan "${guideTitle}"? Panduan ini akan ditarik dari Portal Pengguna dan disimpan dalam arsip internal IT.`;

    openConfirmModal({
      title: `${actionName} Panduan SOP`,
      message,
      confirmText: actionName,
      confirmClass: isPublish
        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white'
        : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white',
      execute: async () => {
        try {
          await window.AdminAPI.guides.updateStatus(guideId, targetStatus);
          showToast(`Status panduan berhasil diubah menjadi ${targetStatus}.`, 'success');
          await loadGuides();
          renderOverviewKPIs();
        } catch (err) {
          showToast(err.message || 'Gagal mengubah status panduan.', 'error');
        }
      },
    });
  };

  window.confirmDeleteGuide = function (guideId, guideTitle) {
    openConfirmModal({
      title: 'Hapus Panduan SOP Secara Permanen',
      message: `PERINGATAN: Apakah Anda yakin ingin menghapus panduan "${guideTitle}" secara permanen? Seluruh langkah troubleshooting terkait akan dihapus dari sistem. Tindakan ini bersifat destruktif dan TIDAK DAPAT DIBATALKAN.`,
      confirmText: 'Hapus Permanen',
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/40',
      execute: async () => {
        try {
          await window.AdminAPI.guides.delete(guideId);
          showToast('Panduan troubleshooting berhasil dihapus secara permanen.', 'success');
          await loadGuides();
          renderOverviewKPIs();
        } catch (err) {
          showToast(err.message || 'Gagal menghapus panduan.', 'error');
        }
      },
    });
  };

  /* ==========================================================================
     9. CATEGORIES MANAGEMENT
     ========================================================================== */

  function renderCategoriesList() {
    const container = document.getElementById('categories-list-container');
    if (!container) return;

    if (state.categories.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-500 text-xs">
          Belum ada kategori terdaftar.
        </div>
      `;
      return;
    }

    const isReadOnly = state.currentUser?.role === 'IT_SUPPORT';

    container.innerHTML = state.categories.map((cat) => `
      <div class="p-5 rounded-2xl bg-slate-900/80 border ${cat.is_active ? 'border-slate-800' : 'border-red-900/30 opacity-75'} flex flex-col justify-between transition-all hover:border-slate-700 shadow-lg">
        <div>
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 shrink-0">
              <span class="material-symbols-outlined text-xl">${escapeHTML(cat.icon || 'devices')}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${
                cat.is_active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'
              }">
                ${cat.is_active ? 'Aktif' : 'Non-aktif'}
              </span>
              <span class="text-[11px] font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800" title="Urutan Tampilan">
                #${cat.display_order || 0}
              </span>
            </div>
          </div>

          <h4 class="text-sm font-bold text-white mb-1">${escapeHTML(cat.name)}</h4>
          <p class="text-[11px] font-mono text-cyan-400/80 mb-2">slug: ${escapeHTML(cat.slug)}</p>
          <p class="text-xs text-slate-400 leading-relaxed line-clamp-3 mb-4">${escapeHTML(cat.description || 'Tidak ada deskripsi.')}</p>
        </div>

        <div class="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
          <span class="text-slate-400 inline-flex items-center gap-1 font-medium">
            <span class="material-symbols-outlined text-sm text-slate-500">article</span>
            <span>${cat.guide_count || 0} Panduan</span>
          </span>

          ${!isReadOnly ? `
            <div class="inline-flex items-center gap-1">
              <button
                onclick="openEditCategoryModal('${cat.id}')"
                class="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors"
                title="Edit Kategori"
              >
                <span class="material-symbols-outlined text-base">edit</span>
              </button>
              <button
                onclick="confirmCategoryStatusToggle('${cat.id}', ${!cat.is_active}, '${escapeHTML(cat.name)}')"
                class="p-1 ${cat.is_active ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'} hover:bg-slate-800 rounded transition-colors"
                title="${cat.is_active ? 'Nonaktifkan Kategori' : 'Aktifkan Kategori'}"
              >
                <span class="material-symbols-outlined text-base">${cat.is_active ? 'toggle_on' : 'toggle_off'}</span>
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  window.openCreateCategoryModal = function () {
    state.editingCategoryId = null;
    const modal = document.getElementById('category-form-modal');
    const title = document.getElementById('category-form-modal-title');
    const form = document.getElementById('category-form');

    if (title) title.textContent = 'Tambah Kategori Hardware Baru';
    if (form) form.reset();

    const activeCheckbox = document.getElementById('cat-form-active');
    if (activeCheckbox) activeCheckbox.checked = true;

    if (modal) modal.classList.remove('hidden');
  };

  window.openEditCategoryModal = function (categoryId) {
    const cat = state.categories.find((c) => c.id === categoryId);
    if (!cat) return;

    state.editingCategoryId = categoryId;
    const modal = document.getElementById('category-form-modal');
    const title = document.getElementById('category-form-modal-title');

    if (title) title.textContent = 'Edit Kategori Hardware';

    document.getElementById('cat-form-name').value = cat.name || '';
    document.getElementById('cat-form-slug').value = cat.slug || '';
    document.getElementById('cat-form-icon').value = cat.icon || 'devices';
    document.getElementById('cat-form-order').value = cat.display_order || 0;
    document.getElementById('cat-form-desc').value = cat.description || '';
    document.getElementById('cat-form-active').checked = cat.is_active;

    if (modal) modal.classList.remove('hidden');
  };

  window.closeCategoryFormModal = function () {
    const modal = document.getElementById('category-form-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.handleCategoryFormSubmit = async function (event) {
    event.preventDefault();
    const submitBtn = document.getElementById('category-form-submit-btn');

    const name = document.getElementById('cat-form-name').value.trim();
    const slug = document.getElementById('cat-form-slug').value.trim();
    const icon = document.getElementById('cat-form-icon').value.trim() || 'devices';
    const display_order = parseInt(document.getElementById('cat-form-order').value, 10) || 0;
    const description = document.getElementById('cat-form-desc').value.trim();
    const is_active = document.getElementById('cat-form-active').checked;

    if (!name) {
      showToast('Nama kategori wajib diisi.', 'error');
      return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
      if (state.editingCategoryId) {
        await window.AdminAPI.categories.update(state.editingCategoryId, {
          name,
          slug: slug || undefined,
          icon,
          display_order,
          description,
        });
        showToast('Kategori berhasil diperbarui!', 'success');
      } else {
        await window.AdminAPI.categories.create({
          name,
          slug: slug || undefined,
          icon,
          display_order,
          description,
          is_active,
        });
        showToast('Kategori baru berhasil ditambahkan!', 'success');
      }

      closeCategoryFormModal();
      await loadCategories();
      await loadGuides();
    } catch (err) {
      showToast(err.message || 'Gagal menyimpan kategori.', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };

  window.confirmCategoryStatusToggle = function (categoryId, targetActive, catName) {
    const actionName = targetActive ? 'Mengaktifkan' : 'Menonaktifkan';
    openConfirmModal({
      title: `${actionName} Kategori`,
      message: `Apakah Anda yakin ingin ${actionName.toLowerCase()} kategori "${catName}"? Kategori yang non-aktif tidak akan muncul di filter publik.`,
      confirmText: actionName,
      confirmClass: targetActive
        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
        : 'bg-red-600 hover:bg-red-500 text-white',
      execute: async () => {
        try {
          await window.AdminAPI.categories.toggleStatus(categoryId, targetActive);
          showToast(`Kategori "${catName}" berhasil ${targetActive ? 'diaktifkan' : 'dinonaktifkan'}.`, 'success');
          await loadCategories();
        } catch (err) {
          showToast(err.message || 'Gagal mengubah status kategori.', 'error');
        }
      },
    });
  };

  /* ==========================================================================
     10. CONFIRMATION DIALOG & LOGOUT
     ========================================================================== */

  function openConfirmModal({ title, message, confirmText, confirmClass, execute }) {
    const modal = document.getElementById('admin-confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const msgEl = document.getElementById('confirm-modal-message');
    const actionBtn = document.getElementById('confirm-modal-action-btn');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (actionBtn) {
      actionBtn.textContent = confirmText || 'Konfirmasi';
      actionBtn.className = `px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-md ${confirmClass || 'bg-cyan-600 hover:bg-cyan-500 text-white'}`;
    }

    state.pendingAction = execute;
    if (modal) modal.classList.remove('hidden');
  }

  window.closeConfirmModal = function () {
    const modal = document.getElementById('admin-confirm-modal');
    state.pendingAction = null;
    if (modal) modal.classList.add('hidden');
  };

  window.executeConfirmAction = async function () {
    if (typeof state.pendingAction === 'function') {
      const fn = state.pendingAction;
      closeConfirmModal();
      await fn();
    }
  };

  window.confirmLogout = function () {
    openConfirmModal({
      title: 'Konfirmasi Keluar Sesi',
      message: 'Apakah Anda yakin ingin mengakhiri sesi portal staf IT saat ini?',
      confirmText: 'Keluar Sekarang',
      confirmClass: 'bg-red-600 hover:bg-red-500 text-white',
      execute: async () => {
        try {
          await window.AdminAPI.auth.logout();
          showToast('Sesi telah berakhir. Mengalihkan...', 'info');
          setTimeout(() => {
            window.location.replace('/admin/login');
          }, 400);
        } catch (err) {
          window.location.replace('/admin/login');
        }
      },
    });
  };

  /* ==========================================================================
     11. TOAST NOTIFICATION SYSTEM & UTILITIES
     ========================================================================== */

  window.showToast = function (message, type = 'info') {
    const container = document.getElementById('admin-toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const id = `toast-${Date.now()}`;
    toast.id = id;

    let bgClass = 'bg-slate-800 border-slate-700 text-slate-200';
    let icon = 'info';

    if (type === 'success') {
      bgClass = 'bg-emerald-950/90 border-emerald-700/60 text-emerald-200';
      icon = 'check_circle';
    } else if (type === 'error') {
      bgClass = 'bg-red-950/90 border-red-700/60 text-red-200';
      icon = 'error';
    }

    toast.className = `flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md text-xs transition-all duration-300 transform translate-y-2 opacity-0 ${bgClass}`;
    toast.innerHTML = `
      <span class="material-symbols-outlined text-base shrink-0">${icon}</span>
      <span class="flex-1 font-medium">${escapeHTML(message)}</span>
      <button onclick="document.getElementById('${id}').remove()" class="text-slate-400 hover:text-white ml-2">
        <span class="material-symbols-outlined text-sm">close</span>
      </button>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-2', 'opacity-0');
    });

    // Auto-remove after 4s
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  };

  function renderStatusBadge(status) {
    if (status === 'PUBLISHED') {
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        <span>PUBLISHED</span>
      </span>`;
    }
    if (status === 'DRAFT') {
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
        <span>DRAFT</span>
      </span>`;
    }
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-700/40 text-slate-400 border border-slate-600/40">
      <span>ARCHIVED</span>
    </span>`;
  }

  function getStatusDotClass(status) {
    if (status === 'PUBLISHED') return 'bg-emerald-400';
    if (status === 'DRAFT') return 'bg-amber-400';
    return 'bg-slate-500';
  }

  /* ==========================================================================
     8. USER MANAGEMENT MODULE (MILESTONE M8)
     ========================================================================== */

  async function loadUsers() {
    try {
      const users = await window.AdminAPI.users.getAll();
      state.users = users || [];

      // Update User Stats
      const total = state.users.length;
      const active = state.users.filter((u) => u.is_active).length;
      const inactive = total - active;
      const admins = state.users.filter((u) => u.role === 'ADMIN' || u.role === 'IT_MANAGER').length;

      const totalEl = document.getElementById('user-stats-total');
      const activeEl = document.getElementById('user-stats-active');
      const inactiveEl = document.getElementById('user-stats-inactive');
      const adminsEl = document.getElementById('user-stats-admins');

      if (totalEl) totalEl.textContent = total;
      if (activeEl) activeEl.textContent = active;
      if (inactiveEl) inactiveEl.textContent = inactive;
      if (adminsEl) adminsEl.textContent = admins;

      return state.users;
    } catch (err) {
      console.error('[AdminDashboard] Failed to load IT staff users:', err);
      showToast(err.message || 'Gagal memuat data staf IT.', 'error');
      return [];
    }
  }

  function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    let users = [...state.users];

    // Filter by Search
    if (state.userFilter.search) {
      const q = state.userFilter.search;
      users = users.filter((u) =>
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
      );
    }

    // Filter by Role
    if (state.userFilter.role && state.userFilter.role !== 'ALL') {
      users = users.filter((u) => u.role === state.userFilter.role);
    }

    // Filter by Status
    if (state.userFilter.status === 'active') {
      users = users.filter((u) => u.is_active);
    } else if (state.userFilter.status === 'inactive') {
      users = users.filter((u) => !u.is_active);
    }

    state.filteredUsers = users;

    if (users.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-12 text-center text-slate-500">
            <div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800/80 mb-2">
              <span class="material-symbols-outlined text-slate-400">person_off</span>
            </div>
            <p class="text-xs font-semibold text-slate-400">Tidak ada staf IT yang cocok dengan filter pencarian.</p>
          </td>
        </tr>
      `;
      return;
    }

    const currentActor = state.currentUser;
    const isActorReadOnly = currentActor && currentActor.role === 'IT_SUPPORT';

    tbody.innerHTML = users.map((u) => {
      const isSelf = currentActor && currentActor.id === u.id;
      const isActorManager = currentActor && currentActor.role === 'IT_MANAGER';
      const isTargetHigherOrEqual = u.role === 'ADMIN' || u.role === 'IT_MANAGER';

      let roleBadgeClass = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      if (u.role === 'ADMIN') {
        roleBadgeClass = 'bg-red-500/10 text-red-400 border-red-500/30';
      } else if (u.role === 'IT_MANAGER') {
        roleBadgeClass = 'bg-[#0097A7]/10 text-cyan-400 border-[#0097A7]/30';
      }

      const statusBadge = u.is_active
        ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <span>Aktif</span>
          </span>`
        : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>
            <span>Nonaktif</span>
          </span>`;

      // Action Button
      let actionBtnHTML = '';
      if (isActorReadOnly) {
        actionBtnHTML = `<span class="text-[11px] text-slate-500 italic">Read-Only</span>`;
      } else if (isSelf) {
        actionBtnHTML = `
          <button disabled class="px-2.5 py-1 rounded-lg text-slate-500 bg-slate-800/40 border border-slate-700/40 text-[11px] font-semibold cursor-not-allowed" title="Anda tidak dapat menonaktifkan akun sendiri">
            Akun Anda
          </button>
        `;
      } else if (isActorManager && isTargetHigherOrEqual) {
        actionBtnHTML = `
          <button disabled class="px-2.5 py-1 rounded-lg text-slate-500 bg-slate-800/40 border border-slate-700/40 text-[11px] font-semibold cursor-not-allowed" title="IT Manager hanya berwenang mengelola IT Support">
            Dibatasi
          </button>
        `;
      } else if (u.is_active) {
        actionBtnHTML = `
          <button
            onclick="confirmToggleUserStatus('${u.id}', '${escapeHTML(u.username)}', true)"
            class="rbac-mutation px-2.5 py-1 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
            title="Nonaktifkan akun staf"
          >
            <span class="material-symbols-outlined text-sm">block</span>
            <span>Nonaktifkan</span>
          </button>
        `;
      } else {
        actionBtnHTML = `
          <button
            onclick="confirmToggleUserStatus('${u.id}', '${escapeHTML(u.username)}', false)"
            class="rbac-mutation px-2.5 py-1 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-semibold transition-colors flex items-center gap-1"
            title="Aktifkan kembali akun staf"
          >
            <span class="material-symbols-outlined text-sm">check_circle</span>
            <span>Aktifkan</span>
          </button>
        `;
      }

      return `
        <tr class="hover:bg-slate-800/40 transition-colors">
          <td class="py-3 px-5">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-bold flex items-center justify-center text-xs shrink-0">
                ${escapeHTML(u.full_name ? u.full_name.charAt(0).toUpperCase() : 'U')}
              </div>
              <div class="min-w-0">
                <span class="font-bold text-slate-200 block truncate leading-tight">${escapeHTML(u.full_name)}</span>
                <span class="text-[11px] font-mono text-slate-400 block mt-0.5">@${escapeHTML(u.username)}</span>
              </div>
            </div>
          </td>
          <td class="py-3 px-4 text-slate-300 font-mono text-[11px] truncate max-w-[200px]">
            ${escapeHTML(u.email)}
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${roleBadgeClass}">
              ${escapeHTML(u.role)}
            </span>
          </td>
          <td class="py-3 px-4">
            ${statusBadge}
          </td>
          <td class="py-3 px-4 text-slate-400 text-[11px]">
            ${formatDate(u.created_at)}
          </td>
          <td class="py-3 px-5 text-right">
            <div class="flex items-center justify-end gap-2">
              ${actionBtnHTML}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.handleUserSearch = function (value) {
    state.userFilter.search = (value || '').toLowerCase().trim();
    renderUsersTable();
  };

  window.handleUserRoleFilter = function (value) {
    state.userFilter.role = value;
    renderUsersTable();
  };

  window.handleUserStatusFilter = function (value) {
    state.userFilter.status = value;
    renderUsersTable();
  };

  window.openUserModal = function () {
    const modal = document.getElementById('user-modal');
    if (!modal) return;

    // Reset Form
    const form = document.getElementById('user-form');
    if (form) form.reset();

    // Populate role choices based on actor role
    const roleSelect = document.getElementById('user-form-role');
    const roleHint = document.getElementById('user-form-role-hint');

    if (roleSelect) {
      roleSelect.innerHTML = '';
      const actorRole = state.currentUser ? state.currentUser.role : 'IT_SUPPORT';

      if (actorRole === 'ADMIN') {
        roleSelect.innerHTML = `
          <option value="IT_SUPPORT" selected>IT_SUPPORT (Read-Only Portal Staf)</option>
          <option value="IT_MANAGER">IT_MANAGER (Manajer Operasional IT)</option>
          <option value="ADMIN">ADMIN (Super Administrator)</option>
        `;
        if (roleHint) roleHint.textContent = 'Administrator dapat membuat seluruh jenis role staf IT.';
      } else if (actorRole === 'IT_MANAGER') {
        roleSelect.innerHTML = `
          <option value="IT_SUPPORT" selected>IT_SUPPORT (Read-Only Portal Staf)</option>
        `;
        if (roleHint) roleHint.textContent = 'IT Manager hanya berwenang membuat akun IT Support.';
      } else {
        roleSelect.innerHTML = `<option value="" disabled selected>Akses Tidak Diizinkan</option>`;
      }
    }

    modal.classList.remove('hidden');
  };

  window.closeUserModal = function () {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
  };

  window.handleUserFormSubmit = async function (event) {
    event.preventDefault();

    const nameInput = document.getElementById('user-form-name');
    const usernameInput = document.getElementById('user-form-username');
    const emailInput = document.getElementById('user-form-email');
    const roleInput = document.getElementById('user-form-role');
    const passwordInput = document.getElementById('user-form-password');
    const submitBtn = document.getElementById('user-form-submit-btn');

    const fullName = nameInput ? nameInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim().toLowerCase() : '';
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
    const role = roleInput ? roleInput.value : '';
    const password = passwordInput ? passwordInput.value : '';

    if (!fullName || !username || !email || !role || !password) {
      showToast('Seluruh field formulir staf wajib diisi.', 'error');
      return;
    }

    if (password.length < 8) {
      showToast('Password minimal harus terdiri dari 8 karakter.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span>
        <span>Menyimpan...</span>
      `;
    }

    try {
      await window.AdminAPI.users.create({
        full_name: fullName,
        username,
        email,
        password,
        role,
      });

      showToast(`Akun staf "${username}" (${role}) berhasil dibuat.`, 'success');
      closeUserModal();
      await loadUsers();
      renderUsersTable();
    } catch (err) {
      console.error('[AdminDashboard] Create user failed:', err);
      showToast(err.message || 'Gagal membuat akun staf IT.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <span class="material-symbols-outlined text-base">person_add</span>
          <span>Simpan Akun Staf</span>
        `;
      }
    }
  };

  window.confirmToggleUserStatus = function (userId, username, willDeactivate) {
    const title = willDeactivate ? 'Nonaktifkan Akun Staf' : 'Aktifkan Akun Staf';
    const message = willDeactivate
      ? `Apakah Anda yakin ingin menonaktifkan akun staf "${username}"? Pengguna tidak akan dapat login atau memperpanjang sesi aktif hingga diaktifkan kembali.`
      : `Apakah Anda yakin ingin mengaktifkan kembali akun staf "${username}"? Pengguna akan dapat segera login kembali ke portal.`;

    openConfirmModal({
      title,
      message,
      confirmText: willDeactivate ? 'Ya, Nonaktifkan' : 'Ya, Aktifkan',
      confirmClass: willDeactivate ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white',
      execute: async () => {
        try {
          await window.AdminAPI.users.toggleStatus(userId, !willDeactivate);
          showToast(`Akun "${username}" berhasil ${willDeactivate ? 'dinonaktifkan' : 'diaktifkan kembali'}.`, 'success');
          await loadUsers();
          renderUsersTable();
        } catch (err) {
          console.error('[AdminDashboard] Toggle user status failed:', err);
          showToast(err.message || 'Gagal memperbarui status akun.', 'error');
        }
      },
    });
  };

  /* ==========================================================================
     9. AUDIT TRAIL MODULE (MILESTONE M8)
     ========================================================================= */

  async function loadAuditLogs() {
    const tbody = document.getElementById('audit-table-body');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-slate-500 text-xs">Mengambil riwayat log audit sistem...</td></tr>`;
    }

    try {
      const logs = await window.AdminAPI.auditLogs.getAll({ limit: 100 });
      state.auditLogs = logs || [];
      renderAuditTable();
      return state.auditLogs;
    } catch (err) {
      console.error('[AdminDashboard] Failed to load audit logs:', err);
      showToast(err.message || 'Gagal memuat log audit aktivitas.', 'error');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400 text-xs">${escapeHTML(err.message || 'Gagal memuat log audit.')}</td></tr>`;
      }
      return [];
    }
  }

  function renderAuditTable() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    let logs = [...state.auditLogs];

    // Filter search
    if (state.auditFilter.search) {
      const q = state.auditFilter.search;
      logs = logs.filter((log) => {
        const actorName = log.actor ? `${log.actor.username || ''} ${log.actor.full_name || ''}`.toLowerCase() : '';
        const action = (log.action || '').toLowerCase();
        const entity = (log.entity_name || '').toLowerCase();
        return actorName.includes(q) || action.includes(q) || entity.includes(q);
      });
    }

    // Filter action
    if (state.auditFilter.action && state.auditFilter.action !== 'ALL') {
      logs = logs.filter((log) => log.action === state.auditFilter.action);
    }

    state.filteredAuditLogs = logs;

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="py-12 text-center text-slate-500">
            <div class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800/80 mb-2">
              <span class="material-symbols-outlined text-slate-400">history_toggle_off</span>
            </div>
            <p class="text-xs font-semibold text-slate-400">Belum ada rekaman audit yang sesuai dengan filter.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map((log) => {
      // Action Badge
      let actionBadgeClass = 'bg-slate-700/30 text-slate-300 border-slate-600';
      if (log.action.includes('CREATED') || log.action === 'LOGIN_SUCCESS' || log.action === 'ACCOUNT_ACTIVATED') {
        actionBadgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      } else if (log.action.includes('UPDATED') || log.action.includes('CHANGED')) {
        actionBadgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      } else if (log.action.includes('DISABLED') || log.action === 'LOGIN_FAILED' || log.action.includes('ARCHIVED')) {
        actionBadgeClass = 'bg-red-500/10 text-red-400 border-red-500/30';
      } else if (log.action === 'LOGOUT') {
        actionBadgeClass = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      }

      // Actor info
      const actorUsername = log.actor ? log.actor.username : 'Sistem / Anonim';
      const actorRole = log.actor ? log.actor.role : 'GUEST';

      return `
        <tr class="hover:bg-slate-800/40 transition-colors">
          <td class="py-3 px-5 text-slate-400 font-mono text-[11px] whitespace-nowrap">
            ${formatDateTime(log.created_at)}
          </td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-200">@${escapeHTML(actorUsername)}</span>
              <span class="text-[9px] px-1.5 py-0.2 rounded border border-slate-700 text-slate-400">${escapeHTML(actorRole)}</span>
            </div>
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${actionBadgeClass}">
              ${escapeHTML(log.action)}
            </span>
          </td>
          <td class="py-3 px-4 text-slate-300 font-mono text-[11px]">
            <span class="uppercase font-bold text-slate-400">${escapeHTML(log.entity_name)}</span>
            <span class="text-[10px] text-slate-500 block truncate max-w-[140px]" title="${escapeHTML(log.entity_id)}">${escapeHTML(log.entity_id)}</span>
          </td>
          <td class="py-3 px-4 text-slate-400 font-mono text-[11px]">
            ${escapeHTML(log.ip_address || '-')}
          </td>
          <td class="py-3 px-5 text-right">
            <button
              onclick="openAuditDetailModal('${log.id}')"
              class="px-2.5 py-1 rounded-lg text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-cyan-500/30 text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
            >
              <span class="material-symbols-outlined text-sm">visibility</span>
              <span>Detail</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.handleAuditSearch = function (value) {
    state.auditFilter.search = (value || '').toLowerCase().trim();
    renderAuditTable();
  };

  window.handleAuditActionFilter = function (value) {
    state.auditFilter.action = value;
    renderAuditTable();
  };

  window.openAuditDetailModal = function (auditId) {
    const modal = document.getElementById('audit-detail-modal');
    const container = document.getElementById('audit-detail-content');
    if (!modal || !container) return;

    const log = state.auditLogs.find((item) => item.id === auditId);
    if (!log) return;

    const actor = log.actor || { username: 'Sistem', role: 'SYSTEM' };

    container.innerHTML = `
      <div class="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">Waktu Kejadian</span>
          <span class="font-mono text-slate-200 font-semibold">${formatDateTime(log.created_at)}</span>
        </div>
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">Pelaksana (Actor)</span>
          <span class="text-slate-200 font-semibold">@${escapeHTML(actor.username)} (${escapeHTML(actor.role)})</span>
        </div>
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">Aksi / Tindakan</span>
          <span class="font-mono text-cyan-400 font-bold">${escapeHTML(log.action)}</span>
        </div>
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">Objek Sasaran</span>
          <span class="text-slate-200 font-semibold">${escapeHTML(log.entity_name)} (${escapeHTML(log.entity_id)})</span>
        </div>
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">Alamat IP</span>
          <span class="font-mono text-slate-400">${escapeHTML(log.ip_address || '-')}</span>
        </div>
        <div>
          <span class="text-slate-500 block text-[10px] uppercase font-bold">User-Agent</span>
          <span class="font-mono text-slate-400 truncate block text-[10px]" title="${escapeHTML(log.user_agent || '-')}">${escapeHTML(log.user_agent || '-')}</span>
        </div>
      </div>

      <div>
        <span class="text-xs font-bold text-slate-300 block mb-2">Payload Data Perubahan (Sanitized Changes):</span>
        <pre class="bg-slate-950 p-4 rounded-xl text-emerald-400 font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed max-h-60">${escapeHTML(JSON.stringify(log.changes || {}, null, 2))}</pre>
      </div>
    `;

    modal.classList.remove('hidden');
  };

  window.closeAuditDetailModal = function () {
    const modal = document.getElementById('audit-detail-modal');
    if (modal) modal.classList.add('hidden');
  };

  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch (e) {
      return '-';
    }
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (e) {
      return '-';
    }
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})(window, document);
