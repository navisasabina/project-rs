const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { aiRateLimiter } = require('../middleware/rate-limiter');

// Medical and clinical trigger terms for patient safety boundary
const CLINICAL_REFUSAL_TERMS = [
  'obat', 'dosis', 'resep obat', 'paracetamol', 'amoxicillin', 'antibiotik',
  'sakit dada', 'nyeri dada', 'serangan jantung', 'stroke', 'sesak napas',
  'infeksi', 'keluhan pasien', 'tekanan darah', 'tensi', 'demam berdarah',
  'diagnosa medis', 'penyakit pasien', 'gejala kanker', 'gejala penyakit'
];

/**
 * Checks if the question attempts clinical or medical consultation
 */
function isClinicalQuery(text) {
  const lower = text.toLowerCase();
  return CLINICAL_REFUSAL_TERMS.some(term => lower.includes(term));
}

/**
 * Score relevance of a guide against the user query
 */
function computeGuideRelevance(guide, query) {
  const qTokens = query.toLowerCase().split(/[\s,.-]+/).filter(t => t.length > 2);
  if (qTokens.length === 0) return 0;

  let score = 0;
  const titleLower = (guide.title || '').toLowerCase();
  const keywordsLower = (guide.keywords || '').toLowerCase();
  const causesLower = (guide.possible_causes || '').toLowerCase();
  const scopeLower = (guide.location_scope || '').toLowerCase();
  const catLower = (guide.category_name || '').toLowerCase();

  let symptomsText = '';
  try {
    const symArr = typeof guide.symptoms === 'string' ? JSON.parse(guide.symptoms) : guide.symptoms;
    if (Array.isArray(symArr)) symptomsText = symArr.join(' ').toLowerCase();
  } catch (e) {
    symptomsText = String(guide.symptoms || '').toLowerCase();
  }

  for (const token of qTokens) {
    if (titleLower.includes(token)) score += 10;
    if (keywordsLower.includes(token)) score += 6;
    if (symptomsText.includes(token)) score += 5;
    if (causesLower.includes(token)) score += 4;
    if (catLower.includes(token)) score += 3;
    if (scopeLower.includes(token)) score += 2;
  }

  // Exact key_code match bonus
  if (qTokens.includes(guide.key_code.toLowerCase())) {
    score += 15;
  }

  return score;
}

/**
 * POST /api/v1/ai/diagnose
 * Asisten Diagnostik AI IT Rumah Sakit dengan Grounding SOP PostgreSQL
 */
router.post('/diagnose', aiRateLimiter, async (req, res) => {
  try {
    const { message, question, prompt } = req.body || {};
    const rawQuery = typeof message === 'string' ? message : (typeof question === 'string' ? question : (typeof prompt === 'string' ? prompt : null));

    // 1. Input Validation
    if (!rawQuery || !rawQuery.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Pesan kendala atau pertanyaan tidak boleh kosong.',
        },
      });
    }

    const trimmedQuery = rawQuery.trim();
    if (trimmedQuery.length > 500) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INPUT_TOO_LONG',
          message: 'Pertanyaan melebihi batas maksimal 500 karakter.',
        },
      });
    }

    // 2. Safety Refusal for Clinical/Medical Queries
    if (isClinicalQuery(trimmedQuery)) {
      return res.status(200).json({
        success: true,
        data: {
          title: 'Batasan Layanan IT Support',
          category: 'Pemberitahuan Medis',
          intro: 'Asisten AI ini khusus menangani kendala teknis perangkat keras (hardware), jaringan, dan software operasional IT RS Awal Bros. Sistem ini tidak berwenang memberikan saran medis, diagnosa klinis pasien, maupun anjuran resep obat.',
          steps: [
            'Untuk kondisi kegawatdaruratan medis pasien, segera aktifkan Code Blue medis atau hubungi IGD Rumah Sakit.',
            'Untuk konsultasi resep obat atau keluhan klinis pasien, hubungi Dokter Penanggung Jawab Pasien (DPJP) atau Farmasi Klinis.',
            'Jika kendala terjadi pada perangkat komputer/printer di instalasi farmasi atau IGD, silakan sebutkan kendala fisiknya (contoh: printer etiket macet, PC kasir mati).'
          ],
          note: 'Keselamatan pasien adalah prioritas utama. Jangan gunakan sistem IT ini untuk keputusan klinis.',
          source: 'SAFETY_REFUSAL',
        },
      });
    }

    // 3. Grounding: Retrieve Published SOPs from PostgreSQL
    const guidesQuery = `
      SELECT 
        g.id,
        g.key_code,
        g.title,
        g.location_scope,
        g.user_description,
        g.symptoms,
        g.possible_causes,
        g.security_note,
        g.keywords,
        c.name AS category_name,
        c.slug AS category_slug
      FROM guides g
      JOIN categories c ON c.id = g.category_id
      WHERE g.status = 'PUBLISHED'
        AND c.is_active = TRUE
      ORDER BY c.display_order ASC, g.title ASC;
    `;

    const guidesResult = await db.query(guidesQuery);
    const publishedGuides = guidesResult.rows;

    if (publishedGuides.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          title: 'Panduan IT RS Awal Bros',
          category: 'IT Support',
          intro: 'Tidak ada panduan SOP yang aktif saat ini. Silakan hubungi tim teknisi IT Rumah Sakit secara langsung.',
          steps: [
            'Periksa sambungan kabel daya dan perangkat keras.',
            'Hubungi Tim IT Support RS Awal Bros via Ext 104.'
          ],
          note: 'Tim IT standby melayani kendala operasional rumah sakit.',
          source: 'DATABASE_SOP_GROUNDED',
        },
      });
    }

    // Rank guides by relevance to find the primary SOP match
    let bestGuide = publishedGuides[0];
    let highestScore = -1;

    for (const guide of publishedGuides) {
      const score = computeGuideRelevance(guide, trimmedQuery);
      if (score > highestScore) {
        highestScore = score;
        bestGuide = guide;
      }
    }

    // Retrieve deterministic ordered steps for the matched guide
    const stepsQuery = `
      SELECT step_number, title, instruction
      FROM guide_steps
      WHERE guide_id = $1
      ORDER BY step_number ASC;
    `;
    const stepsResult = await db.query(stepsQuery, [bestGuide.id]);
    const guideSteps = stepsResult.rows;

    // Construct grounded fallback response
    const localFallbackResponse = {
      title: bestGuide.title,
      category: bestGuide.category_name,
      intro: bestGuide.user_description || `Panduan penanganan kendala ${bestGuide.title} pada area ${bestGuide.location_scope} sesuai SOP resmi RS Awal Bros.`,
      steps: guideSteps.map(s => `${s.title} — ${s.instruction}`),
      note: bestGuide.security_note || 'Bila kendala belum teratasi dalam 3 menit, segera hubungi tim IT Ext 104.',
    };

    // 4. Check GEMINI_API_KEY configuration
    const apiKey = process.env.GEMINI_API_KEY;
    const isApiKeyConfigured = apiKey && 
      apiKey !== 'dummy' && 
      apiKey !== 'placeholder' && 
      apiKey !== 'your-gemini-api-key' &&
      !apiKey.startsWith('dummy_');

    if (!isApiKeyConfigured) {
      // Graceful local degradation: PostgreSQL SOP is the source of truth
      return res.status(200).json({
        success: true,
        data: {
          ...localFallbackResponse,
          source: 'DATABASE_SOP_GROUNDED',
        },
      });
    }

    // 5. Call Gemini AI with Grounded Context and strict safety timeout
    try {
      const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const groundedContext = `
PANDUAN SOP RESMI RS AWAL BROS (SUMBER KEBENARAN TUNGGAL):
- Judul SOP: ${bestGuide.title}
- Kategori: ${bestGuide.category_name}
- Cakupan Lokasi: ${bestGuide.location_scope}
- Gejala & Indikasi: ${JSON.stringify(bestGuide.symptoms)}
- Kemungkinan Penyebab: ${bestGuide.possible_causes || '-'}
- Catatan Keselamatan: ${bestGuide.security_note || '-'}
- Prosedur Langkah Resmi:
${guideSteps.map(s => `  Langkah ${s.step_number} (${s.title}): ${s.instruction}`).join('\n')}
      `.trim();

      const systemPrompt = `
Anda adalah Asisten Virtual IT Support RS Awal Bros Botania.
BATASAN KETAT:
1. SUMBER KEBENARAN TUNGGAL adalah data SOP resmi RS Awal Bros yang tertera di atas.
2. JANGAN mengarang atau menambahkan langkah teknis di luar konteks SOP yang diberikan.
3. JANGAN PERNAH memberikan saran medis, diagnosa penyakit, maupun anjuran obat.
4. Respon HARUS dalam format JSON valid dengan struktur:
{
  "title": "string (judul diagnosis/panduan singkat)",
  "category": "string (kategori perangkat)",
  "intro": "string (penjelasan singkat akar masalah sesuai SOP)",
  "steps": ["string (langkah 1)", "string (langkah 2)", ...],
  "note": "string (peringatan keselamatan penting)"
}
`.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout

      const response = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: `${systemPrompt}\n\n${groundedContext}\n\nPERTANYAAN USER:\n"${trimmedQuery}"`
            }]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800,
            responseMimeType: 'application/json'
          }
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Gemini API returned HTTP status ${response.status}`);
      }

      const jsonResult = await response.json();
      const rawCandidateText = jsonResult?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawCandidateText) {
        throw new Error('Gemini API returned empty candidate content');
      }

      let parsedAI = null;
      try {
        parsedAI = JSON.parse(rawCandidateText);
      } catch (parseErr) {
        // Strip code fence if Gemini returned markdown json
        const cleaned = rawCandidateText.replace(/```json/gi, '').replace(/```/g, '').trim();
        parsedAI = JSON.parse(cleaned);
      }

      if (parsedAI && parsedAI.title && Array.isArray(parsedAI.steps) && parsedAI.steps.length > 0) {
        return res.status(200).json({
          success: true,
          data: {
            title: parsedAI.title,
            category: parsedAI.category || bestGuide.category_name,
            intro: parsedAI.intro || localFallbackResponse.intro,
            steps: parsedAI.steps,
            note: parsedAI.note || bestGuide.security_note,
            source: 'GEMINI_AI_GROUNDED',
          },
        });
      }

      // If parsed structure is incomplete, fall back to database SOP
      throw new Error('Incomplete structure in Gemini response');
    } catch (aiErr) {
      // Graceful local degradation: PostgreSQL SOP is returned reliably
      console.warn('[AI Diagnostic] Gemini generation unavailable or timed out, returning PostgreSQL SOP fallback:', aiErr.name || 'Error');
      return res.status(200).json({
        success: true,
        data: {
          ...localFallbackResponse,
          source: 'DATABASE_SOP_FALLBACK',
        },
      });
    }
  } catch (err) {
    console.error('[AI Diagnostic Error]:', err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan saat memproses diagnosa IT.',
      },
    });
  }
});

module.exports = router;
