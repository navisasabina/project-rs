/**
 * Admin API Client Adapter — RS Awal Bros IT Knowledge Base
 * 
 * Provides unified, promise-based access to M5 (Auth) and M6 (Admin KB) REST endpoints.
 * Automatically handles HttpOnly cookie credentials, status codes, and error envelopes.
 */

(function (window) {
  'use strict';

  const BASE_URL = '/api/v1';

  /**
   * Internal fetch wrapper with standardized error handling and credentials inclusion
   */
  async function apiRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const defaultHeaders = {
      'Accept': 'application/json',
    };

    if (options.body && typeof options.body === 'object') {
      defaultHeaders['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const config = {
      ...options,
      credentials: 'include', // Crucial: forwards HttpOnly session cookie
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    };

    let response;
    try {
      response = await fetch(url, config);
    } catch (netErr) {
      const err = new Error('Tidak dapat terhubung ke server backend. Periksa koneksi jaringan Anda.');
      err.code = 'NETWORK_ERROR';
      throw err;
    }

    let json = null;
    try {
      json = await response.json();
    } catch (parseErr) {
      json = null;
    }

    if (!response.ok) {
      const err = new Error(
        json && json.error && json.error.message
          ? json.error.message
          : `Permintaan gagal dengan kode HTTP ${response.statusCode || response.status}.`
      );
      err.status = response.status;
      err.code = (json && json.error && json.error.code) ? json.error.code : 'UNKNOWN_ERROR';
      err.details = json;

      // Handle session expiry or unauthorized
      if (response.status === 401 && !window.location.pathname.includes('/admin/login')) {
        console.warn('[AdminAPI] Sesi kedaluwarsa (HTTP 401). Mengarahkan ke login...');
        window.dispatchEvent(new CustomEvent('admin:unauthorized', { detail: err }));
      }

      throw err;
    }

    return json;
  }

  const AdminAPI = {
    auth: {
      /**
       * Login user with username and password
       * @param {string} username 
       * @param {string} password 
       */
      async login(username, password) {
        const res = await apiRequest('/auth/login', {
          method: 'POST',
          body: { username, password },
        });
        return res.data;
      },

      /**
       * Logout current active user and clear session cookie
       */
      async logout() {
        const res = await apiRequest('/auth/logout', {
          method: 'POST',
        });
        return res.data;
      },

      /**
       * Get current user session profile
       */
      async getProfile() {
        const res = await apiRequest('/auth/me', {
          method: 'GET',
        });
        return res.data;
      },
    },

    categories: {
      /**
       * Get all categories including inactive ones with guide counts
       */
      async getAll() {
        const res = await apiRequest('/admin/categories', {
          method: 'GET',
        });
        return res.data;
      },

      /**
       * Create a new category
       */
      async create(data) {
        const res = await apiRequest('/admin/categories', {
          method: 'POST',
          body: data,
        });
        return res.data;
      },

      /**
       * Update existing category metadata
       */
      async update(id, data) {
        const res = await apiRequest(`/admin/categories/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: data,
        });
        return res.data;
      },

      /**
       * Toggle category active status
       */
      async toggleStatus(id, isActive) {
        const res = await apiRequest(`/admin/categories/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: { is_active: isActive },
        });
        return res.data;
      },
    },

    guides: {
      /**
       * Get all guides across all statuses with optional filtering
       * @param {object} [filters] { status, category }
       */
      async getAll(filters = {}) {
        const params = new URLSearchParams();
        if (filters.status && filters.status !== 'ALL') {
          params.append('status', filters.status);
        }
        if (filters.category && filters.category !== 'ALL') {
          params.append('category', filters.category);
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        const res = await apiRequest(`/admin/guides${query}`, {
          method: 'GET',
        });
        return res.data;
      },

      /**
       * Get full guide detail including ordered steps and category
       */
      async getById(id) {
        const res = await apiRequest(`/admin/guides/${encodeURIComponent(id)}`, {
          method: 'GET',
        });
        return res.data;
      },

      /**
       * Create a new guide with inline steps
       */
      async create(data) {
        const res = await apiRequest('/admin/guides', {
          method: 'POST',
          body: data,
        });
        return res.data;
      },

      /**
       * Update guide metadata
       */
      async update(id, data) {
        const res = await apiRequest(`/admin/guides/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: data,
        });
        return res.data;
      },

      /**
       * Update guide lifecycle status (DRAFT -> PUBLISHED -> ARCHIVED)
       */
      async updateStatus(id, status) {
        const res = await apiRequest(`/admin/guides/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: { status },
        });
        return res.data;
      },

      /**
       * Replace guide steps sequentially
       */
      async updateSteps(id, steps) {
        const res = await apiRequest(`/admin/guides/${encodeURIComponent(id)}/steps`, {
          method: 'PUT',
          body: { steps },
        });
        return res.data;
      },
    },

    users: {
      /**
       * Get list of IT staff users
       * @param {object} [filters] { role, status, search }
       */
      async getAll(filters = {}) {
        const params = new URLSearchParams();
        if (filters.role && filters.role !== 'ALL') params.append('role', filters.role);
        if (filters.status && filters.status !== 'ALL') params.append('status', filters.status);
        if (filters.search && filters.search.trim()) params.append('search', filters.search.trim());
        const query = params.toString() ? `?${params.toString()}` : '';
        const res = await apiRequest(`/admin/users${query}`, {
          method: 'GET',
        });
        return res.data;
      },

      /**
       * Create new IT staff user
       * @param {object} userData { full_name, username, email, password, role }
       */
      async create(userData) {
        const res = await apiRequest('/admin/users', {
          method: 'POST',
          body: userData,
        });
        return res.data;
      },

      /**
       * Toggle active/inactive status of IT staff user
       * @param {string} id
       * @param {boolean} isActive
       */
      async toggleStatus(id, isActive) {
        const res = await apiRequest(`/admin/users/${encodeURIComponent(id)}/status`, {
          method: 'PATCH',
          body: { is_active: isActive },
        });
        return res.data;
      },
    },

    auditLogs: {
      /**
       * Get read-only list of audit events
       * @param {object} [filters] { action, entity, search, limit, offset }
       */
      async getAll(filters = {}) {
        const params = new URLSearchParams();
        if (filters.action && filters.action !== 'ALL') params.append('action', filters.action);
        if (filters.entity && filters.entity !== 'ALL') params.append('entity', filters.entity);
        if (filters.search && filters.search.trim()) params.append('search', filters.search.trim());
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);
        const query = params.toString() ? `?${params.toString()}` : '';
        const res = await apiRequest(`/admin/audit-logs${query}`, {
          method: 'GET',
        });
        return res.data;
      },
    },
  };

  // Expose globally to window
  window.AdminAPI = AdminAPI;

})(window);
