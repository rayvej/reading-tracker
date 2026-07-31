/**
 * Gemini AI Service for Scholarly Note Analysis & Automation
 * Integrates directly with Gemini REST API using client-side API Key & multi-model fallback.
 */

const DEFAULT_GEMINI_CANDIDATES = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-2.5-flash',
  'gemini-1.5-flash-8b'
];

/**
 * Dynamically fetch active supported models for user's API key via Google ModelService ListModels
 */
export async function getActiveGeminiModel(apiKey) {
  const cachedModel = typeof localStorage !== 'undefined' ? localStorage.getItem('rt_gemini_working_model') : null;
  if (cachedModel && cachedModel.trim()) {
    return cachedModel.trim();
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models || [];
      const validModels = models.filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'));
      
      if (validModels.length > 0) {
        const flashModel = validModels.find(m => m.name && m.name.includes('flash'));
        const chosen = flashModel ? flashModel.name : validModels[0].name;
        const cleanName = chosen.replace(/^models\//, '').replace(/-pro$/, '-flash');
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('rt_gemini_working_model', cleanName);
        }
        return cleanName;
      }
    }
  } catch (e) {
    console.warn('[Gemini ListModels] Dynamic lookup failed, falling back to candidates:', e);
  }

  return 'gemini-1.5-flash';
}

/**
 * Execute Gemini REST API request trying candidate models until a supported model succeeds
 */
export async function callGeminiApiWithFallback(apiKey, bodyObj) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Gemini API key is not configured');
  }

  const cleanKey = apiKey.trim();
  const dynamicModel = await getActiveGeminiModel(cleanKey);

  const candidatesToTry = [...new Set([
    dynamicModel,
    ...DEFAULT_GEMINI_CANDIDATES
  ].map(m => m.replace(/^models\//, '').replace(/-pro$/, '-flash')))];

  let rateLimitError = null;
  let primaryError = null;

  for (const modelName of candidatesToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj)
      });

      if (response.ok) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('rt_gemini_working_model', modelName);
        }
        return await response.json();
      }

      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `API error (${response.status})`;

      // 429 / Quota / Rate limit
      if (response.status === 429 || errMsg.includes('Quota exceeded') || errMsg.includes('rate-limit') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        console.warn(`[Gemini API] Rate limit on ${modelName}: "${errMsg}".`);
        rateLimitError = `Free tier rate limit reached on Google Gemini. Please retry in a few seconds.`;
        continue;
      }

      // 404 / Model not found or not supported
      if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('not supported') || errMsg.includes('ModelService')) {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('rt_gemini_working_model');
        }
        console.warn(`[Gemini API] Model ${modelName} unavailable: "${errMsg}". Retrying...`);
        if (!primaryError) {
          primaryError = `Gemini AI service temporarily busy. Please retry in a few seconds.`;
        }
        continue;
      }

      // Invalid key or permission error
      if (response.status === 400 || response.status === 403 || errMsg.includes('API key not valid')) {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('rt_gemini_api_key');
        }
        throw new Error(`Invalid Gemini API key. Please check your key in Settings.`);
      }

      primaryError = errMsg;
    } catch (e) {
      if (e.message && e.message.includes('Invalid Gemini API key')) throw e;
      if (e.message && (e.message.includes('Quota exceeded') || e.message.includes('rate-limit') || e.message.includes('RESOURCE_EXHAUSTED'))) {
        rateLimitError = `Free tier rate limit reached. Please retry in a few seconds.`;
        continue;
      }
      if (!primaryError && e.message) {
        primaryError = e.message;
      }
    }
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('rt_gemini_working_model');
  }

  // Sanitize any residual error message so raw model strings like gemini-1.5-pro are NEVER thrown to the user
  const finalMsg = rateLimitError || primaryError || 'Google Gemini rate limit reached. Please retry in a few seconds.';
  const sanitizedMsg = (finalMsg.includes('not found for API version') || finalMsg.includes('ModelService.ListModels'))
    ? 'Google Gemini service rate limit reached. Please retry in a few seconds.'
    : finalMsg;

  throw new Error(sanitizedMsg);
}

/**
 * Validate user's Gemini API Key by making a minimal prompt call
 */
export async function testGeminiApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('API key is empty');
  }

  try {
    const data = await callGeminiApiWithFallback(apiKey, {
      contents: [{ parts: [{ text: 'Respond with the exact word: OK' }] }]
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { success: true, text: text.trim(), isRateLimited: false };
  } catch (err) {
    // If the error is a quota / rate limit error (429 / Quota exceeded), the API key IS valid!
    if (err.message.includes('Quota exceeded') || err.message.includes('Rate Limit') || err.message.includes('rate limit') || err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('429')) {
      return { success: true, text: 'OK', isRateLimited: true };
    }
    throw err;
  }
}

/**
 * Parse JSON safely from Gemini response text (strips markdown codeblocks if present)
 */
function parseGeminiJsonResponse(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('Failed to parse Gemini JSON directly, raw response:', rawText);
    return {
      title: 'Starred Story Note',
      summary: rawText.slice(0, 200),
      quote: rawText,
      characters: [],
      themes: ['Scholarship'],
      era: '',
      location: ''
    };
  }
}

/**
 * Analyze photo of reading note / book page via OCR and multimodal Gemini API
 */
export async function analyzeNoteImage(base64Image, mimeType = 'image/jpeg', apiKey) {
  if (!apiKey) throw new Error('Gemini API key is not configured');

  // Strip prefix if present (e.g. data:image/jpeg;base64,)
  const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  const prompt = `You are an expert Bahá'í scholar and academic research assistant. 
Analyze this image of a book page or reading note. Perform OCR to extract any text, then analyze the content.
Identify:
1. "title": A short, memorable title for the story or passage (e.g. "Táhirih at Badašt", "‘Abdu’l-Bahá's Hospitality").
2. "summary": A concise 2-3 sentence narrative summary.
3. "quote": The key excerpt or verbatim quote.
4. "characters": An array of historical figures/characters mentioned, using standard Bahá'í transliterations (e.g., Bahá'u'lláh, 'Abdu'l-Bahá, Táhirih, Mullá Husayn, Quddús).
5. "themes": An array of 1-3 thematic tags (e.g., Covenant, Steadfastness, Progressive Revelation, Heroism, Hospitality).
6. "era": Historical era if identifiable (e.g., Heroic Age, Formative Age, 1844-1853).
7. "location": Geographical location if mentioned (e.g., Shiraz, 'Akká, Baghdad, Tehran).

Return ONLY a valid, raw JSON object with keys: "title", "summary", "quote", "characters", "themes", "era", "location". Do not include markdown code block formatting or additional commentary.`;

  const data = await callGeminiApiWithFallback(apiKey, {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: prompt }
      ]
    }]
  });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseGeminiJsonResponse(rawText);
}

/**
 * Analyze spoken voice transcript / text note with Gemini NLP
 */
export async function analyzeVoiceTranscript(transcriptText, apiKey) {
  if (!apiKey) throw new Error('Gemini API key is not configured');

  const prompt = `You are an expert Bahá'í scholar and academic research assistant.
Analyze the following reading note / spoken transcript:
"${transcriptText}"

Please:
1. Correct and standardize any Bahá'í transliterations (e.g., Tahirih -> Táhirih, Iqan -> Kitáb-i-Íqán, Abdul Baha -> ‘Abdu’l-Bahá, Bahaullah -> Bahá'u'lláh).
2. Extract:
   - "title": Short memorable story/passage title.
   - "summary": Concise narrative summary.
   - "quote": Notable excerpt or cleaned transcript text.
   - "characters": Array of historical figures mentioned.
   - "themes": Array of thematic tags.
   - "era": Historical period if mentioned.
   - "location": City/country if mentioned.

Return ONLY a valid, raw JSON object with keys: "title", "summary", "quote", "characters", "themes", "era", "location". Do not include markdown code blocks.`;

  const data = await callGeminiApiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }]
  });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseGeminiJsonResponse(rawText);
}

/**
 * Standardize Bahá'í transliteration in raw text
 */
export async function standardizeTransliteration(rawText, apiKey) {
  if (!apiKey) {
    return fallbackTransliterate(rawText);
  }

  const prompt = `Standardize all Bahá'í terms, names, and book titles in the following text using official Bahá'í transliteration accents (á, í, ú, ḥ, ṭ, z, ṣ, ‘, ’).
Example: Baha'u'llah -> Bahá'u'lláh, Abdul-Baha -> ‘Abdu’l-Bahá, Tahirih -> Táhirih, Kitab-i-Iqan -> Kitáb-i-Íqán, Baha'i -> Bahá'í, Mulla Husayn -> Mullá Husayn, Quddus -> Quddús.

Text to process:
"${rawText}"

Return ONLY the corrected string. Do not add quotes, introductory text, or explanations.`;

  try {
    const data = await callGeminiApiWithFallback(apiKey, {
      contents: [{ parts: [{ text: prompt }] }]
    });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text.trim() || rawText;
  } catch (e) {
    console.warn('Gemini transliteration fetch failed, using fallback:', e);
  }

  return fallbackTransliterate(rawText);
}

/**
 * Rule-based offline transliteration fallback
 */
export function fallbackTransliterate(text) {
  if (!text) return text;
  const rules = [
    [/\bBaha'u'llah\b/gi, "Bahá'u'lláh"],
    [/\bBaha'is?\b/gi, "Bahá'í"],
    [/\bBaha'i\b/gi, "Bahá'í"],
    [/\bAbdul-?Baha\b/gi, "‘Abdu’l-Bahá"],
    [/\bAbdu'l-Baha\b/gi, "‘Abdu’l-Bahá"],
    [/\bBab\b/g, "Báb"],
    [/\bTahirih\b/gi, "Táhirih"],
    [/\bMulla Husayn\b/gi, "Mullá Husayn"],
    [/\bQuddus\b/gi, "Quddús"],
    [/\bKitab-i-Iqan\b/gi, "Kitáb-i-Íqán"],
    [/\bKitab-i-Aqdas\b/gi, "Kitáb-i-Aqdas"],
    [/\bHidden Words\b/gi, "The Hidden Words"],
    [/\bShoghi Effendi\b/gi, "Shoghi Effendi"]
  ];
  let out = text;
  rules.forEach(([regex, repl]) => {
    out = out.replace(regex, repl);
  });
  return out;
}

/**
 * Generate academic citations and paper digest for a book
 */
export function generateScholarlyDigest(book, sessions = [], stories = [], quotes = []) {
  const author = book.author || 'Unknown Author';
  const title = book.title || 'Untitled Work';
  const year = book.pubYear || book.year || new Date().getFullYear();
  const publisher = book.publisher || "Bahá'í Publishing Trust";
  const location = book.city || 'Wilmette, IL';

  // BibTeX
  const citeKey = (author.split(' ').pop() + year + title.split(' ')[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
  const bibtex = `@book{${citeKey},
  author = {${author}},
  title = {${title}},
  year = {${year}},
  publisher = {${publisher}},
  address = {${location}}
}`;

  // Chicago Style
  const chicago = `${author}. *${title}*. ${location}: ${publisher}, ${year}.`;

  // APA Style
  const apa = `${author}. (${year}). *${title}*. ${publisher}.`;

  // Markdown Digest
  let md = `# Scholarly Digest: ${title}\n\n`;
  md += `**Author:** ${author}  \n`;
  md += `**Publication:** ${location}: ${publisher}, ${year}  \n`;
  md += `**Total Sessions:** ${sessions.length}  \n`;
  md += `**Starred Stories Captured:** ${stories.length}  \n\n`;

  md += `## Academic Citations\n`;
  md += `**Chicago:** ${chicago}\n\n`;
  md += `**APA:** ${apa}\n\n`;
  md += `\`\`\`bibtex\n${bibtex}\n\`\`\`\n\n`;

  if (stories.length > 0) {
    md += `## Starred Stories & Narrative Anecdotes\n\n`;
    stories.forEach((s, idx) => {
      md += `### ${idx + 1}. ${s.title || 'Untitled Story'} (Page ${s.page || 'N/A'}${s.paragraph ? `, §${s.paragraph}` : ''})\n`;
      if (s.summary) md += `*${s.summary}*\n\n`;
      if (s.quote) md += `> "${s.quote}"\n\n`;
      if (s.characters && s.characters.length) md += `**Figures:** ${s.characters.join(', ')}  \n`;
      if (s.themes && s.themes.length) md += `**Themes:** ${s.themes.join(', ')}  \n`;
      if (s.era) md += `**Era/Period:** ${s.era}  \n`;
      md += `\n---\n\n`;
    });
  }

  return { bibtex, chicago, apa, markdown: md };
}


