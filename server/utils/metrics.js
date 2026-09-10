/**
 * Operational Metrics Utility
 * 
 * Lightweight, zero-dependency, in-memory metrics tracker for hospital IT platform.
 * Tracks process health, request throughput, latencies, rate limits, and AI/search events.
 */

class MetricsRegistry {
  constructor() {
    this.reset();
  }

  reset() {
    this.startTime = Date.now();
    this.requests = {
      total: 0,
      byStatusFamily: {
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
        'other': 0,
      },
      cumulativeDurationMs: 0,
      recentLatencies: [],
    };

    this.rateLimits = {
      login: 0,
      ai: 0,
    };

    this.ai = {
      totalRequests: 0,
      geminiAttempts: 0,
      geminiSuccesses: 0,
      geminiFallbacks: 0,
      dbGrounded: 0,
      safetyRefusals: 0,
    };

    this.search = {
      totalSearches: 0,
      ftsQueries: 0,
      ilikeFallbacks: 0,
      cumulativeDurationMs: 0,
    };

    this.database = {
      queryErrors: 0,
    };
  }

  recordRequest(statusCode, durationMs) {
    this.requests.total++;
    const code = Number(statusCode) || 0;

    if (code >= 200 && code < 300) {
      this.requests.byStatusFamily['2xx']++;
    } else if (code >= 300 && code < 400) {
      this.requests.byStatusFamily['3xx']++;
    } else if (code >= 400 && code < 500) {
      this.requests.byStatusFamily['4xx']++;
    } else if (code >= 500 && code < 600) {
      this.requests.byStatusFamily['5xx']++;
    } else {
      this.requests.byStatusFamily['other']++;
    }

    if (typeof durationMs === 'number' && durationMs >= 0) {
      this.requests.cumulativeDurationMs += durationMs;
      this.requests.recentLatencies.push(durationMs);
      if (this.requests.recentLatencies.length > 100) {
        this.requests.recentLatencies.shift();
      }
    }
  }

  recordRateLimit(type) {
    if (type === 'login') {
      this.rateLimits.login++;
    } else if (type === 'ai') {
      this.rateLimits.ai++;
    }
  }

  recordAiEvent(event) {
    switch (event) {
      case 'request':
        this.ai.totalRequests++;
        break;
      case 'gemini_attempt':
        this.ai.geminiAttempts++;
        break;
      case 'gemini_success':
        this.ai.geminiSuccesses++;
        break;
      case 'gemini_fallback':
        this.ai.geminiFallbacks++;
        break;
      case 'db_grounded':
        this.ai.dbGrounded++;
        break;
      case 'safety_refusal':
        this.ai.safetyRefusals++;
        break;
      default:
        break;
    }
  }

  recordSearch(durationMs, usedFts = true) {
    this.search.totalSearches++;
    if (usedFts) {
      this.search.ftsQueries++;
    } else {
      this.search.ilikeFallbacks++;
    }
    if (typeof durationMs === 'number' && durationMs >= 0) {
      this.search.cumulativeDurationMs += durationMs;
    }
  }

  recordDbError() {
    this.database.queryErrors++;
  }

  getSnapshot() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const avgLatencyMs = this.requests.total > 0
      ? Number((this.requests.cumulativeDurationMs / this.requests.total).toFixed(2))
      : 0;

    const recentAvgLatencyMs = this.requests.recentLatencies.length > 0
      ? Number((this.requests.recentLatencies.reduce((a, b) => a + b, 0) / this.requests.recentLatencies.length).toFixed(2))
      : 0;

    const avgSearchLatencyMs = this.search.totalSearches > 0
      ? Number((this.search.cumulativeDurationMs / this.search.totalSearches).toFixed(2))
      : 0;

    const mem = process.memoryUsage();

    return {
      process: {
        uptime_seconds: uptimeSeconds,
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
        memory: {
          heap_used_mb: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
          heap_total_mb: Number((mem.heapTotal / 1024 / 1024).toFixed(2)),
          rss_mb: Number((mem.rss / 1024 / 1024).toFixed(2)),
        },
      },
      http: {
        total_requests: this.requests.total,
        status_families: { ...this.requests.byStatusFamily },
        average_latency_ms: avgLatencyMs,
        recent_average_latency_ms: recentAvgLatencyMs,
      },
      rate_limits: {
        login_rate_limits_total: this.rateLimits.login,
        ai_rate_limits_total: this.rateLimits.ai,
      },
      ai_diagnostics: {
        total_ai_requests: this.ai.totalRequests,
        gemini_attempts: this.ai.geminiAttempts,
        gemini_successes: this.ai.geminiSuccesses,
        gemini_fallbacks: this.ai.geminiFallbacks,
        db_grounded_fallbacks: this.ai.dbGrounded,
        safety_refusals: this.ai.safetyRefusals,
      },
      search: {
        total_searches: this.search.totalSearches,
        fts_queries: this.search.ftsQueries,
        ilike_fallbacks: this.search.ilikeFallbacks,
        average_search_latency_ms: avgSearchLatencyMs,
      },
      database: {
        query_errors_total: this.database.queryErrors,
      },
    };
  }
}

const metrics = new MetricsRegistry();

module.exports = metrics;
