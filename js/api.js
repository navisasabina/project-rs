/**
 * Public Knowledge Base API Adapter
 * 
 * Provides abstraction for all HTTP communications with the Express/PostgreSQL API.
 * Uses reasonable timeout via AbortController.
 * Validates basic payload contracts.
 * Normalizes API responses to seamlessly match existing UI shapes.
 */

// Reasonable network timeout (3.5 seconds)
const API_TIMEOUT_MS = 3500;

/**
 * Executes a fetch request with timeout protection
 * @param {string} endpoint 
 * @param {object} options 
 * @returns {Promise<any>}
 */
async function fetchWithTimeout(endpoint, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(options.headers || {}),
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`API HTTP Error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();

    // Validate envelope contract
    if (!json || json.success !== true || json.data === undefined) {
      throw new Error('API Contract Error: Malformed JSON envelope response');
    }

    return json;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      console.warn(`[API Adapter] Request to ${endpoint} timed out after ${API_TIMEOUT_MS}ms.`);
    } else {
      console.warn(`[API Adapter] Request to ${endpoint} failed:`, err.message);
    }
    throw err;
  }
}

/**
 * Normalizes guide detail API response into the exact shape expected by navigation.js / UI
 * @param {object} apiGuide 
 * @returns {object} Normalized SOP Object
 */
function normalizeGuideDetail(apiGuide) {
  if (!apiGuide) return null;

  const steps = Array.isArray(apiGuide.steps) ? apiGuide.steps : [];
  const step1 = steps.find(s => s.step_number === 1) || { title: '', instruction: '' };
  const step2 = steps.find(s => s.step_number === 2) || { title: '', instruction: '' };
  const step3 = steps.find(s => s.step_number === 3) || { title: '', instruction: '' };

  let parsedSymptoms = [];
  if (Array.isArray(apiGuide.symptoms)) {
    parsedSymptoms = apiGuide.symptoms;
  } else if (typeof apiGuide.symptoms === 'string') {
    try {
      parsedSymptoms = JSON.parse(apiGuide.symptoms);
    } catch (e) {
      parsedSymptoms = [];
    }
  }

  return {
    id: apiGuide.id,
    key: apiGuide.key_code,
    title: apiGuide.title,
    category: (apiGuide.category && apiGuide.category.name) ? apiGuide.category.name : '',
    categorySlug: (apiGuide.category && apiGuide.category.slug) ? apiGuide.category.slug : '',
    location: apiGuide.location_scope || '',
    image: apiGuide.image_url || '',
    prompt: apiGuide.prompt_shortcut || apiGuide.title,
    symptoms: parsedSymptoms,
    step1Title: step1.title || '',
    step1Desc: step1.instruction || '',
    step2Title: step2.title || '',
    step2Desc: step2.instruction || '',
    step3Title: step3.title || '',
    step3Desc: step3.instruction || '',
    securityNote: apiGuide.security_note || '',
    keywords: apiGuide.keywords || '',
  };
}

/**
 * Public KnowledgeBase API Client
 */
const KB_API = {
  /**
   * Fetches published categories
   * @returns {Promise<Array>}
   */
  async getCategories() {
    const res = await fetchWithTimeout('/api/v1/categories');
    if (!Array.isArray(res.data)) {
      throw new Error('Malformed categories data array');
    }
    return res.data;
  },

  /**
   * Fetches published guides list
   * @param {string} [categorySlug] 
   * @returns {Promise<Array>}
   */
  async getGuides(categorySlug) {
    const url = categorySlug 
      ? `/api/v1/guides?category=${encodeURIComponent(categorySlug)}`
      : '/api/v1/guides';
    const res = await fetchWithTimeout(url);
    if (!Array.isArray(res.data)) {
      throw new Error('Malformed guides data array');
    }
    return res.data;
  },

  /**
   * Fetches full guide detail by key or UUID
   * @param {string} idOrKey 
   * @returns {Promise<object>}
   */
  async getGuideDetail(idOrKey) {
    const res = await fetchWithTimeout(`/api/v1/guides/${encodeURIComponent(idOrKey)}`);
    if (!res.data || typeof res.data !== 'object') {
      throw new Error('Malformed guide detail data');
    }
    return normalizeGuideDetail(res.data);
  },

  /**
   * Loads full knowledge base dictionary (API primary with fallback to local SOP_DATABASE)
   * @param {object} [fallbackData] Optional local fallback database (defaults to window.SOP_DATABASE)
   * @returns {Promise<{ source: 'API'|'FALLBACK', data: object }>}
   */
  async loadKnowledgeBase(fallbackData) {
    const fallback = fallbackData || (typeof window !== 'undefined' ? window.SOP_DATABASE : {}) || {};

    try {
      const guidesList = await this.getGuides();
      if (!Array.isArray(guidesList) || guidesList.length === 0) {
        throw new Error('Empty guides list returned from API');
      }

      // Fetch details in parallel with safety
      const details = await Promise.all(
        guidesList.map(async (item) => {
          try {
            return await this.getGuideDetail(item.key_code);
          } catch (e) {
            // If individual detail fails, check fallback
            return fallback[item.key_code] || null;
          }
        })
      );

      const normalizedDict = {};
      for (const guide of details) {
        if (guide && guide.key) {
          normalizedDict[guide.key] = guide;
        }
      }

      // If at least one guide successfully parsed
      if (Object.keys(normalizedDict).length > 0) {
        return {
          source: 'API',
          data: normalizedDict,
        };
      } else {
        throw new Error('Could not populate guides from API');
      }
    } catch (err) {
      console.warn('[KB_API] Switching to local SOP_DATABASE fallback:', err.message);
      return {
        source: 'FALLBACK',
        data: fallback,
      };
    }
  },

  /**
   * Helper: Normalizes a guide detail
   */
  normalizeGuideDetail,
};

// Expose globally for browser usage
if (typeof window !== 'undefined') {
  window.KB_API = KB_API;
}

// Support Node.js environment for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchWithTimeout,
    normalizeGuideDetail,
    KB_API,
    API_TIMEOUT_MS,
  };
}
