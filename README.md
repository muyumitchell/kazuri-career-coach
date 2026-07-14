# Kazuri Career Coach — Prototype

A grounded AI internship assistant prototype, built as a portfolio piece alongside a Safaricom internship application.

## Why this exists
The live Kazuri chatbot sometimes gives inaccurate or unhelpful answers. This prototype demonstrates one concrete fix: strict grounding. The bot only answers from a verified knowledge base and explicitly says "I don't have that confirmed" instead of guessing on things like exact deadlines, stipend, or interview format — then points the candidate to the official careers portal.

## Stack
Node.js · Express · Groq API (LLaMA 3.3 70B) · Vanilla HTML/CSS/JS

## Run locally
```
npm install
cp .env.example .env   # add your GROQ_API_KEY
npm start
```
Visit http://localhost:3001

## Deploy
Same pattern as Kova/Sage/Remi: push to GitHub, deploy the backend on Render (set GROQ_API_KEY as an environment variable), and either serve /public directly from Render or point Netlify at the Render backend.
