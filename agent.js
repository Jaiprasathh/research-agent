// ─────────────────────────────────────────────
// Research Agent — Day 2
// Robust question decomposer with structured output
// ─────────────────────────────────────────────

const API_ENDPOINT = "/api/chat";

// ── Step helpers ──────────────────────────────

function setStep(stepId, status) {
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
  return data.choices[0].message.content;
}

// ── Parse JSON safely ─────────────────────────

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch {}
  try {
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    return JSON.parse(stripped);
  } catch {}
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  throw new Error("Could not extract JSON from LLM response. Raw: " + raw.slice(0, 200));
}

// ── Step 1: Decompose the question ────────────

async function decomposeQuestion(question) {
  const result = await tryDecompose(question);
  if (result) return result;
  console.warn("First decompose attempt failed, retrying...");
  const retry = await tryDecomposeStrict(question);
  if (retry) return retry;
  throw new Error("Failed to decompose question after 2 attempts.");
}

async function tryDecompose(question) {
  const messages = [
    {
      role: "system",
      content: `You are a research planning assistant.
Your ONLY job is to break a question into exactly 3 focused sub-questions.

RULES:
- Respond with ONLY a JSON array — nothing else
- The array must contain exactly 3 strings
- Each string is a specific sub-question
- No explanations, no markdown, no extra text whatsoever

CORRECT output example:
["What causes X?", "How does Y affect Z?", "What are the consequences of W?"]

WRONG output examples:
- Here are the sub-questions: [...]
- \`\`\`json [...] \`\`\`
- Any text before or after the array`,
    },
    {
      role: "user",
      content: `Break this into 3 sub-questions: "${question}"`,
    },
  ];

  try {
    const raw = await callLLM(messages);
    const parsed = parseJSON(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((s) => typeof s === "string" && s.trim().length > 0)
    ) {
      return parsed.map((s) => s.trim());
    }
    return null;
  } catch (err) {
    console.warn("tryDecompose failed:", err.message);
    return null;
  }
}

async function tryDecomposeStrict(question) {
  const messages = [
    {
      role: "user",
      content: `Break "What is artificial intelligence?" into 3 sub-questions. Reply with only a JSON array.`,
    },
    {
      role: "assistant",
      content: `["What is the definition and history of artificial intelligence?", "How do AI systems learn and make decisions?", "What are the main applications and impacts of AI today?"]`,
    },
    {
      role: "user",
      content: `Break "${question}" into 3 sub-questions. Reply with only a JSON array.`,
    },
  ];

  try {
    const raw = await callLLM(messages);
    const parsed = parseJSON(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      parsed.every((s) => typeof s === "string" && s.trim().length > 0)
    ) {
      return parsed.slice(0, 4).map((s) => s.trim());
    }
    return null;
  } catch (err) {
    console.warn("tryDecomposeStrict failed:", err.message);
    return null;
  }
}

// ── Step 2: Fetch Wikipedia summaries ────────

async function fetchWikipedia(query) {
  const searchTerm = query
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 5)
    .join("_");

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(searchTerm)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.extract ? data.extract.slice(0, 600) : null;
  } catch {
    return null;
  }
}

async function fetchAllSources(subtasks) {
  const results = await Promise.all(
    subtasks.map(async (task) => {
      const summary = await fetchWikipedia(task);
      return {
        question: task,
        source: summary || "No Wikipedia article found for this sub-question.",
      };
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
Use the provided sources — do not make up facts beyond what is given.
Structure:
- Short intro paragraph (2-3 sentences)
- One section per sub-question using ## headings
- Brief conclusion paragraph
Keep the total report under 500 words.`,
    },
    {
      role: "user",
      content: `Write a research report answering: "${originalQuestion}"\n\nSources:\n${sourceText}`,
    },
  ];

  return await callLLM(messages);
}

// ── Animate sub-questions into the UI ─────────

function renderSubtasks(subtasks) {
  const list = document.getElementById("subtasks-list");
  list.innerHTML = "";

  subtasks.forEach((task, i) => {
    const li = document.createElement("li");
    li.setAttribute("data-num", i + 1);
    li.textContent = task;
    li.style.opacity = "0";
    li.style.transform = "translateY(6px)";
    li.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    list.appendChild(li);

    setTimeout(() => {
      li.style.opacity = "1";
      li.style.transform = "translateY(0)";
    }, i * 150);
  });
}

// ── Main orchestrator ─────────────────────────

async function startResearch() {
  const input = document.getElementById("question-input");
  const question = input.value.trim();

  if (!question) {
    showError("Please enter a question first.");
    return;
  }

  if (question.length < 5) {
    showError("Please enter a more detailed question.");
    return;
  }

  hideError();

  document.getElementById("results").style.display = "none";
  document.getElementById("subtasks-list").innerHTML = "";
  document.getElementById("report-output").innerHTML = "";

  const btn = document.getElementById("search-btn");
  btn.disabled = true;
  btn.textContent = "Researching...";

  document.getElementById("steps-panel").style.display = "flex";
  setStep("decompose", "pending");
  setStep("fetch", "pending");
  setStep("report", "pending");

  try {
    setStep("decompose", "active");
    const subtasks = await decomposeQuestion(question);
    setStep("decompose", "done");

    document.getElementById("results").style.display = "block";
    renderSubtasks(subtasks);

    setStep("fetch", "active");
    const sources = await fetchAllSources(subtasks);
    setStep("fetch", "done");

    setStep("report", "active");
    const report = await writeReport(question, sources);
    setStep("report", "done");

    document.getElementById("report-output").innerHTML = marked.parse(report);

  } catch (err) {
    showError("Something went wrong: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Research";
  }
}

document.getElementById("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") startResearch();
});
