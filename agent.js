// ─────────────────────────────────────────────
// Research Agent — Day 1 scaffold
// Tests: Groq API connection + basic UI flow
// ─────────────────────────────────────────────

// In production this hits your Vercel serverless proxy.
// During local testing, swap this to call Groq directly (see comment below).
const API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// ── Step helpers ──────────────────────────────

function setStep(stepId, status) {
  // status: 'pending' | 'active' | 'done'
  const step = document.getElementById("step-" + stepId);
  const icon = document.getElementById("icon-" + stepId);
  step.className = "step " + status;
  icon.className = "step-icon " + status;
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.style.display = "block";
}

function hideError() {
  document.getElementById("error-msg").style.display = "none";
}

// ── LLM call ─────────────────────────────────

async function callLLM(messages) {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("API error: " + err);
  }

  const data = await res.json();
  // Groq response shape: data.choices[0].message.content
  return data.choices[0].message.content;
}

// ── Step 1: Decompose the question ────────────

async function decomposeQuestion(question) {
  const messages = [
    {
      role: "system",
      content: `You are a research planning assistant. 
When given a question, break it into exactly 3 focused sub-questions that together would fully answer it.
Respond ONLY with a JSON array of 3 strings. No explanation, no markdown, no extra text.
Example output: ["What is X?", "How does Y work?", "What are the effects of Z?"]`,
    },
    {
      role: "user",
      content: question,
    },
  ];

  const raw = await callLLM(messages);

  // Parse JSON — strip any accidental markdown fences
  const clean = raw.replace(/```json|```/g, "").trim();
  const subtasks = JSON.parse(clean);

  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    throw new Error("Could not parse sub-questions from LLM response.");
  }

  return subtasks;
}

// ── Step 2: Fetch Wikipedia summaries ────────

async function fetchWikipedia(query) {
  const url =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(query.split(" ").slice(0, 5).join("_"));

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.extract || null;
  } catch {
    return null;
  }
}

async function fetchAllSources(subtasks) {
  const results = await Promise.all(
    subtasks.map(async (task) => {
      const summary = await fetchWikipedia(task);
      return { question: task, source: summary || "No source found for this sub-question." };
    })
  );
  return results;
}

// ── Step 3: Write the report ─────────────────

async function writeReport(originalQuestion, sources) {
  const sourceText = sources
    .map((s, i) => `Sub-question ${i + 1}: ${s.question}\nSource: ${s.source}`)
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content: `You are a research report writer.
Write a clear, well-structured research report in markdown format.
Use the provided sources to ground your answer — do not make up facts.
Structure: short intro paragraph, one section per sub-question with ## heading, then a brief conclusion.
Keep the total report under 500 words.`,
    },
    {
      role: "user",
      content: `Original question: ${originalQuestion}\n\n${sourceText}`,
    },
  ];

  return await callLLM(messages);
}

// ── Main orchestrator ─────────────────────────

async function startResearch() {
  const input = document.getElementById("question-input");
  const question = input.value.trim();

  if (!question) {
    showError("Please enter a question first.");
    return;
  }

  hideError();

  // Reset UI
  document.getElementById("results").style.display = "none";
  document.getElementById("subtasks-list").innerHTML = "";
  document.getElementById("report-output").innerHTML = "";

  const btn = document.getElementById("search-btn");
  btn.disabled = true;
  btn.textContent = "Researching...";

  // Show steps panel
  const panel = document.getElementById("steps-panel");
  panel.style.display = "flex";
  setStep("decompose", "pending");
  setStep("fetch", "pending");
  setStep("report", "pending");

  try {
    // ── Step 1: Decompose ──
    setStep("decompose", "active");
    const subtasks = await decomposeQuestion(question);
    setStep("decompose", "done");

    // Render sub-questions
    const list = document.getElementById("subtasks-list");
    subtasks.forEach((task, i) => {
      const li = document.createElement("li");
      li.setAttribute("data-num", i + 1);
      li.textContent = task;
      list.appendChild(li);
    });

    // ── Step 2: Fetch sources ──
    setStep("fetch", "active");
    const sources = await fetchAllSources(subtasks);
    setStep("fetch", "done");

    // ── Step 3: Write report ──
    setStep("report", "active");
    const report = await writeReport(question, sources);
    setStep("report", "done");

    // Render report (markdown → HTML)
    document.getElementById("report-output").innerHTML = marked.parse(report);
    document.getElementById("results").style.display = "block";

  } catch (err) {
    showError("Something went wrong: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Research";
  }
}

// Allow Enter key to trigger search
document.getElementById("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") startResearch();
});
