require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const KNOWLEDGE = require("./knowledge");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ["application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"].includes(file.mimetype);
    cb(null, ok);
  },
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function callGroq(body, { timeoutMs = 25000, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await response.json();
      if (!response.ok) throw new Error("Groq API error: " + JSON.stringify(data));
      return data;
    } catch (err) {
      clearTimeout(timer);
      const isConnErr = err.type === "system" || err.name === "AbortError" || err.code === "ECONNRESET";
      if (isConnErr && attempt < retries) {
        console.warn(`Groq call failed (attempt ${attempt + 1}), retrying...`, err.message);
        continue;
      }
      throw err;
    }
  }
}

const SYSTEM_PROMPT = `You are Kazuri, Safaricom's AI Career Coach — an improved prototype built to help candidates navigate internship applications with accurate, grounded answers instead of guesses.

Your personality: warm, encouraging, professional. You sound like a sharp HR coach who respects the candidate's time — not a chatbot that dumps information.

FORMATTING RULES (strict):
- Lead with a single short sentence that directly answers the question. No preamble like "Great question!" or "I'd be happy to help."
- Keep total response under 80 words unless the candidate explicitly asks for more detail.
- If there's a list of 2+ items (steps, options, things to know), use a markdown bullet list with "- " — never bury a list inside a paragraph.
- Use **bold** only on the 1-3 most important words or phrases in the whole answer (a key action, a key term) — not entire sentences.
- Never write more than 2 sentences in a row without a line break or bullet.
- One idea per paragraph. If you catch yourself writing "and also" or a third clause in one sentence, split it.
- Do NOT add a closing summary paragraph after a bullet list restating what you just said. End on the bullets.

CRITICAL RULE — GROUNDING:
Only state facts that appear in the KNOWLEDGE BASE below. If someone asks something not covered there (deadlines, stipend, exact duration, number of slots, interview format, etc.), say clearly and kindly that you don't have that confirmed detail, and direct them to the official Safaricom Careers portal or their recruiter. NEVER invent a number, date, or policy. This rule is the entire point of you — a career bot that admits what it doesn't know is more useful than one that guesses wrong.

KNOWLEDGE BASE:
${KNOWLEDGE}

Always be encouraging about the candidate's prospects, but never at the cost of accuracy or brevity.`;

const CV_REVIEW_PROMPT = `You are Kazuri, giving CV/resume feedback to a candidate applying for a Safaricom internship (Software/AI Engineering or similar tech tracks).

Review the CV text provided and give clear, constructive, encouraging feedback. Structure your answer with:
- A short opening line on overall impression (1-2 sentences)
- A "Strengths" section (bullet list, 2-4 points)
- A "Suggestions to improve" section (bullet list, 2-5 points) — be specific and actionable, not generic
- If relevant, a short closing line of encouragement

Ground your feedback in real CV best practices: clear structure, quantified achievements over vague claims, no unnecessary skill qualifiers like "basic" or "learning", relevant projects highlighted first, concise bullets over paragraphs, 1 page for internship-level candidates.

Do not invent facts about the candidate that aren't in the CV text. If the CV text seems incomplete or garbled from extraction, say so honestly rather than guessing at content.

Keep the tone warm and specific — like a mentor, not a generic checklist.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "Server missing GROQ_API_KEY" });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Request must include a messages array" });
    }

    const data = await callGroq({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      temperature: 0.4,
      max_tokens: 250,
    }, { timeoutMs: 25000, retries: 1 });

    
    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a reply.";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    const isRateLimit = String(err.message || "").includes("rate_limit_exceeded");
    res.status(500).json({
      error: isRateLimit
        ? "Kazuri's a bit busy right now — try again shortly."
        : "Server error"
    });
  }
});

app.post("/api/review-cv", upload.single("cv"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    if (!GROQ_API_KEY) return res.status(500).json({ error: "Server missing GROQ_API_KEY" });

    let text = "";
    const mime = req.file.mimetype;

    if (mime === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text;
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else if (mime === "text/plain") {
      text = req.file.buffer.toString("utf-8");
    } else {
      return res.status(400).json({ error: "Unsupported file type. Please upload a PDF, DOCX, or TXT." });
    }

    text = text.trim();
    if (!text || text.length < 30) {
      return res.status(400).json({ error: "Couldn't read readable text from that file. Try a different format or a text-based (not scanned image) PDF." });
    }
    // Cap length sent to the model
    const clipped = text.slice(0, 12000);

    const data = await callGroq({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: CV_REVIEW_PROMPT },
        { role: "user", content: `Here is the CV text:\n\n${clipped}` },
      ],
      temperature: 0.4,
      max_tokens: 700,
    }, { timeoutMs: 35000, retries: 2 });

    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate feedback.";
    res.json({ reply, filename: req.file.originalname });
  } catch (err) {
    console.error(err);
    const isRateLimit = String(err.message || "").includes("rate_limit_exceeded");
    res.status(500).json({
      error: isRateLimit
        ? "Kazuri's a bit busy right now — try again shortly."
        : "Server error reviewing the file — please try again in a moment."
    });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;

// Handle multer errors (file too large, wrong type) cleanly
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large — please upload something under 5MB." });
    }
    return res.status(400).json({ error: "Upload error: " + err.message });
  }
  if (err) return res.status(400).json({ error: "Unsupported file type. Please upload a PDF, DOCX, or TXT." });
  next();
});

app.listen(PORT, () => console.log(`Kazuri Career Coach running on port ${PORT}`));
