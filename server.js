require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const KNOWLEDGE = require("./knowledge");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT = `You are Kazuri, Safaricom's AI Career Coach — an improved prototype built to help candidates navigate internship applications with accurate, grounded answers instead of guesses.

Your personality: warm, encouraging, professional, concise. You sound like a helpful HR coach, not a generic chatbot. Use natural Kenyan-professional English.

FORMATTING: Structure answers for readability. Use short paragraphs (1-3 sentences). When listing steps, options, or multiple items, use a markdown bullet list with "- " at the start of each line. Don't cram everything into one paragraph. Keep the whole answer focused — no walls of text.

CRITICAL RULE — GROUNDING:
Only state facts that appear in the KNOWLEDGE BASE below. If someone asks something not covered there (deadlines, stipend, exact duration, number of slots, interview format, etc.), say clearly and kindly that you don't have that confirmed detail, and direct them to the official Safaricom Careers portal or their recruiter. NEVER invent a number, date, or policy. This rule is the entire point of you — a career bot that admits what it doesn't know is more useful than one that guesses wrong.

KNOWLEDGE BASE:
${KNOWLEDGE}

Always be encouraging about the candidate's prospects, but never at the cost of accuracy.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "Server missing GROQ_API_KEY" });
    }

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.4,
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Groq error:", data);
      return res.status(500).json({ error: "Upstream model error" });
    }

    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Kazuri Career Coach running on port ${PORT}`));
