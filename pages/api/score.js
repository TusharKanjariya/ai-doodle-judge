// pages/api/score.js
import formidable from "formidable";
import fs from "node:fs/promises";

export const config = {
    api: { bodyParser: false },
};

// Pick any *vision-capable* model; start with a free one:
const MODEL_ID = process.env.OPENROUTER_MODEL || "allenai/molmo-7b-d:free";
// Other options: "qwen/qwen-vl-plus:free", "qwen/qwen2.5-vl-32b-instruct:free"

export default async function handler(req, res) {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    if (!process.env.OPENROUTER_API_KEY) {
        return res.status(500).json({ error: "Missing OPENROUTER_API_KEY" });
    }

    try {
        const form = formidable({ multiples: false });
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
        });

        const mode = (fields.mode || "auto").toString();

        // Handle both array and single file shapes
        let fileObj = files.image;
        if (Array.isArray(fileObj)) fileObj = fileObj[0];
        if (!fileObj?.filepath) return res.status(400).json({ error: "No image uploaded" });

        // Read file -> base64 data URL (OpenRouter vision accepts base64 via image_url.url)
        const buf = await fs.readFile(fileObj.filepath);
        const mime = fileObj.mimetype || "image/png";
        const base64 = buf.toString("base64");
        const dataUrl = `data:${mime};base64,${base64}`;

        // Build the vision prompt
        const system = `You are an art critique assistant.
Given a user's drawing, return STRICT JSON with keys:
- score: integer 0-100 (higher is better)
- label: short subject guess (e.g., "cat", "house")
- confidence: number 0-1
- feedback: one concise sentence with a practical improvement tip.

Consider the judging mode="${mode}" (auto|accuracy|style|composition).`;

        const userText = `Judge this drawing. Respond with ONLY JSON, no markdown code fences.`;

        const payload = {
            model: MODEL_ID,
            messages: [
                { role: "system", content: [{ type: "text", text: system }] },
                {
                    role: "user",
                    content: [
                        { type: "text", text: userText },
                        { type: "image_url", image_url: { url: dataUrl } },
                    ],
                },
            ],
            // Helps many models stay terse/structured
            temperature: 0.2,
            max_tokens: 300,
        };

        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                // (Optional but recommended for attribution)
                "HTTP-Referer": process.env.SITE_URL || "http://localhost:3000",
                "X-Title": "Judge My Drawing",
            },
            body: JSON.stringify(payload),
        });

        if (!r.ok) {
            const text = await r.text().catch(() => "");
            return res.status(502).json({ error: "OpenRouter error", detail: text });
        }

        const data = await r.json();
        const content = data?.choices?.[0]?.message?.content?.trim();

        // Try to parse JSON; if model added code fences, strip them
        const jsonText = content?.replace(/^```json|```$/g, "").trim();
        let out;
        try {
            out = JSON.parse(jsonText);
        } catch {
            // Fallback: return a friendly error
            return res.status(502).json({ error: "Model returned non-JSON", raw: content });
        }

        // Basic shape guard + defaults
        const result = {
            score: Math.max(0, Math.min(100, Number(out.score) || 0)),
            label: typeof out.label === "string" ? out.label : "—",
            confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
            feedback: typeof out.feedback === "string" ? out.feedback : "No feedback.",
        };

        return res.status(200).json(result);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "Failed to score image" });
    }
}
