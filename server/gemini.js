// Minimal Gemini REST client (no SDK, so nothing breaks on SDK version changes).
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const hasGemini = () => !!process.env.GEMINI_API_KEY && process.env.MOCK_AGENT !== '1';
export const modelName = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export async function generate(body, { timeoutMs = 45000 } = {}) {
  const model = modelName();
  const res = await fetch(`${BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json();
}

// Fast settings for one-shot vision calls: no "thinking" on 2.5 Flash models.
function fastConfig() {
  return /2\.5-flash/.test(modelName()) ? { thinkingConfig: { thinkingBudget: 0 } } : {};
}

// One-shot multimodal call that returns parsed JSON matching `schema`.
export async function visionJSON(prompt, images, schema) {
  const parts = [{ text: prompt }];
  images.forEach((img, i) => {
    if (images.length > 1) parts.push({ text: `Image ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } });
  });
  const r = await generate({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1, ...fastConfig() },
  });
  const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return JSON.parse(text);
}
