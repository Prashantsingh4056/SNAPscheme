// ─────────────────────────────────────────────────────────────────────────────
//  SchemeSnap · src/controllers/policyController.js
//
//  Zero-disk-write pipeline:
//    1. Multer delivers PDF bytes as a Buffer in req.file.buffer (RAM only).
//    2. pdf-parse extracts the raw text layer from the buffer – no temp files.
//    3. Gemini 2.5 Flash rewrites the text as structured Markdown in the
//       requested regional language.
//    4. The Markdown string is returned as JSON – never stored server-side.
// ─────────────────────────────────────────────────────────────────────────────

import { GoogleGenAI } from '@google/genai';
import pdfParse from 'pdf-parse';

// ── Gemini clients (lazy per-key singletons) ──────────────────────────────────
// Instantiated on first request so the server can boot even before .env is
// populated; avoids a hard crash at import time during health checks.
const _aiByKey = new Map();
const getAPIKeys = () => {
  const parseKeys = (configuredKeys) =>
    [...new Set((configuredKeys || '').split(',').map((key) => key.trim()).filter(Boolean))];
  const apiKeys = parseKeys(process.env.GEMINI_API_KEYS);
  if (apiKeys.length === 0) {
    apiKeys.push(...parseKeys(process.env.GEMINI_API_KEY));
  }
  if (apiKeys.length === 0) {
    throw Object.assign(
      new Error('GEMINI_API_KEYS or GEMINI_API_KEY is not configured. Add it to your .env file.'),
      { status: 503 },
    );
  }
  return apiKeys;
};

const getAI = (apiKey) => {
  if (!_aiByKey.has(apiKey)) {
    _aiByKey.set(apiKey, new GoogleGenAI({ apiKey }));
  }
  return _aiByKey.get(apiKey);
};

const isQuotaOrRateLimitError = (error) => {
  const status = Number(error?.status ?? error?.response?.status);
  const code = String(error?.code ?? error?.error?.status ?? error?.error?.code ?? '');
  const message = String(error?.message ?? error?.error?.message ?? '');
  return (
    status === 429 ||
    /RESOURCE_EXHAUSTED/i.test(code) ||
    /rate.?limit|quota|resource.?exhausted|too many requests/i.test(message)
  );
};

const generateContentWithFallback = async (request) => {
  const apiKeys = getAPIKeys();
  for (let index = 0; index < apiKeys.length; index += 1) {
    try {
      return await getAI(apiKeys[index]).models.generateContent(request);
    } catch (error) {
      if (!isQuotaOrRateLimitError(error) || index === apiKeys.length - 1) {
        throw error;
      }
      console.warn(
        `[SchemeSnap] Gemini API key ${index + 1} was rate limited or quota exhausted; trying the next key.`,
      );
    }
  }
};

// ── Supported languages → display label mapping ────────────────────────────────
const SUPPORTED_LANGUAGES = new Set([
  'English',
  'Hindi',
  'Telugu',
  'Tamil',
  'Kannada',
  'Marathi',
]);

// ── System prompt factory ──────────────────────────────────────────────────────
// Produces a detailed, structured prompt that forces Gemini to output exactly
// four Markdown sections, fully translated into the target language.
const buildSystemPrompt = (extractedText, language) => `
You are SchemeSnap — an elite civic-technology AI trained to translate dense government policy documents into clear, accessible citizen guidance.

## YOUR TASK
Analyse the government policy text provided below and produce a single, well-structured Markdown document that makes the policy understandable to an ordinary citizen.

## STRICT OUTPUT FORMAT
You MUST produce **exactly** these four top-level headers in this exact order, using the exact emoji and text shown:

### 🏛️ Scheme Overview
- A brief, plain-language description of what this scheme/policy is about.
- Who launched it, when, and what problem it solves.

### 💰 Key Benefits Provided
- A clear bullet-list of every financial grant, subsidy, service, or benefit the citizen receives.
- Include amounts, durations, and conditions where stated.

### 📋 Eligibility Validation Checklist
- A checkbox list using "- [ ]" Markdown syntax for every eligibility criterion.
- Each item must be a single, actionable check the citizen can verify about themselves.

### 🚀 Actionable Application Steps
- A numbered step-by-step guide the citizen must follow to apply.
- Include required documents, offices, websites, helpline numbers, and deadlines if mentioned.

## LANGUAGE REQUIREMENT
**Translate your ENTIRE response — including all headers, bullet points, and explanatory text — into ${language}.**
If ${language} is English, respond in plain, simple English (reading level: Grade 8).
For all other languages, use natural, colloquial phrasing that a first-generation smartphone user from a rural area would understand.
Do NOT mix languages. The entire output must be in ${language} only.

## QUALITY RULES
- Do not invent benefits or criteria not present in the source text.
- If a section has no relevant information in the source, write "Not specified in the document." (translated).
- Keep formatting clean: no raw HTML, no triple-backtick code fences inside your answer.
- Bold (**text**) key terms, thresholds, and deadlines for emphasis.

## GOVERNMENT POLICY TEXT TO ANALYSE
---
${extractedText}
---
`.trim();

// ── Controller ─────────────────────────────────────────────────────────────────
export const simplifyPolicy = async (req, res) => {
  try {
    // ── 1. Validate file presence ─────────────────────────────────────────────
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file received. Send a PDF under the "document" field.' });
    }

    // ── 2. Validate & sanitise language selection ─────────────────────────────
    const rawLanguage = (req.body.language || 'English').trim();
    const language = SUPPORTED_LANGUAGES.has(rawLanguage) ? rawLanguage : 'English';

    // ── 3. Parse PDF from in-memory Buffer (ZERO disk I/O) ────────────────────
    let extractedText = '';
    try {
      const pdfData = await pdfParse(req.file.buffer);
      extractedText = pdfData.text ? pdfData.text.trim() : '';
    } catch (parseError) {
      // pdf-parse throws when the PDF has no readable character map
      console.error('[SchemeSnap] pdf-parse error →', parseError.message);
      return res.status(422).json({
        error:
          'Unable to extract text from this PDF. The document may be a scanned image without a text layer, password-protected, or corrupted.',
      });
    }

    // ── 4. Guard: reject image-only / empty PDFs ──────────────────────────────
    if (!extractedText || extractedText.length < 50) {
      return res.status(422).json({
        error:
          'The PDF contains insufficient extractable text (fewer than 50 characters). Please upload a text-based PDF, not a scanned image.',
      });
    }

    // ── 5. Truncate to avoid exceeding model context window ───────────────────
    // Gemini 2.5 Flash supports a large context but we cap at ~120 k chars
    // (~30 k tokens) to keep latency and cost predictable.
    const MAX_CHARS = 120_000;
    const textToProcess =
      extractedText.length > MAX_CHARS
        ? extractedText.slice(0, MAX_CHARS) + '\n\n[Document truncated for processing…]'
        : extractedText;

    // ── 6. Build prompt & call Gemini 2.5 Flash ───────────────────────────────
    const prompt = buildSystemPrompt(textToProcess, language);

    const response = await generateContentWithFallback({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const simplifiedMarkdown = response.text;

    if (!simplifiedMarkdown || simplifiedMarkdown.trim().length === 0) {
      return res.status(500).json({ error: 'The AI model returned an empty response. Please try again.' });
    }

    // ── 7. Return result – never stored server-side ───────────────────────────
    return res.status(200).json({
      success: true,
      language,
      fileName: req.file.originalname,
      simplifiedContent: simplifiedMarkdown.trim(),
    });
  } catch (error) {
    console.error('[SchemeSnap] Controller error →', error);

    // Surface Gemini API errors clearly
    if (isQuotaOrRateLimitError(error)) {
      return res.status(429).json({
        error: 'All configured Gemini API keys are rate limited or quota exhausted. Please try again later.',
      });
    }
    if (error?.status === 400) {
      return res.status(400).json({ error: 'Gemini rejected the request. The PDF content may contain unsupported characters.' });
    }

    return res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
  }
};
