// ==============================================
// Research Agent — Day 5
// What's new:
//   1. updateStep() — replaces setStep()
//      Shows sub-detail text, elapsed time,
//      error state with red icon
//   2. Step timers — records start time per step,
//      shows "Completed in Xs" when done
//   3. Progressive sub-details — each step shows
//      what it found, not just that it finished
//   4. Error state — red icon + clear message
//      when any step fails
// Key concepts: DOM manipulation in real time,
//               CSS state-driven styling,
//               Date.now() for timing
// ==============================================

const API_ENDPOINT = "/api/chat";

// ── Step timing tracker ───────────────────────
// Stores the start time for each step so we can
// show how long each one took when it finishes.
const stepTimers = {};

// ── updateStep() — DAY 5 CORE FUNCTION ───────
//
// CONCEPT: CSS state-driven styling
// We set a class name and let CSS handle visuals.
// JS handles logic. CSS handles appearance.
// They never mix — this is clean separation.
//
// Parameters:
//   stepId — "decompose" | "fetch" | "report"
//   status — "pending" | "active" | "done" | "error"
//   detail — optional sub-detail text below label

function updateStep(stepId, status, detail = "") {
  const step    = document.getElementById("step-" + stepId);
  const icon    = document.getElementById("icon-" + stepId);
  const label   = document.getElementById("label-" + stepId);
  const detailEl = document.getElementById("detail-" + stepId);
  const timeEl  = document.getElementById("time-" + stepId);

  if (!step || !icon) return;

  // Set CSS classes — CSS handles all visual changes
  step.className = "step " + status;
  icon.className = "step-icon " + status;

  // Update label colour and weight per status
  if (label) {
    if (status === "pending") {
      label.style.color = "";
      label.style.fontWeight = "";
    } else if (status === "active") {
      label.style.color = "#1a1a18";
      label.style.fontWeight = "500";
    } else if (status === "done") {
      label.style.color = "#3B6D11";
      label.style.fontWeight = "500";
    } else if (status === "error") {
      label.style.color = "#c0392b";
      label.style.fontWeight = "500";
    }
  }

  // Show detail text if provided
  if (detailEl) {
    if (detail) {
      detailEl.textContent = detail;
      detailEl.style.display = "block";
    } else {
      detailEl.style.display = "none";
    }
  }

  // Record start time when going active
  if (status === "active") {
    stepTimers[stepId] = Date.now();
    if (timeEl) timeEl.style.display = "none";
  }

  // Show elapsed time on done or error
  if ((status === "done" || status === "error") && stepTimers[stepId]) {
    const elapsed = ((Date.now() - stepTimers[stepId]) / 1000).toFixed(1);
    if (timeEl) {
      timeEl.textContent = status === "done"
        ? `Completed in ${elapsed}s`
        : `Failed after ${elapsed}s`;
      timeEl.style.display = "block";
    }
  }
}

// ── Error / hide helpers ──────────────────────

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

// ── JSON parser with 3 fallback strategies ────

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
  throw new Error("Could not extract JSON from LLM response.");
}

// ── STEP 1: Decompose ─────────────────────────

async function decomposeQuestion(question) {
  const result = await tryDecompose(question);
  if (result) return result;
  const retry = await tryDecomposeStrict(question);
  if (retry) return retry;
  throw new Error("Failed to decompose question after 2 attempts.");
}

async function tryDecompose(question) {
  const messages = [
    {
      role: "system",
      content: `You are a research planning assistant.
Break the question into exactly 3 focused sub-questions.
Respond with ONLY a JSON array of 3 strings. No explanation, no markdown.
Example: ["What is X?", "How does Y work?", "What are effects of Z?"]`,
    },
    { role: "user", content: `Break this into 3 sub-questions: "${question}"` },
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
  } catch { return null; }
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
  } catch { return null; }
}

// ── STEP 2: Wikipedia sources ─────────────────

async function searchWikipedia(query) {
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
  try {
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const results = searchData?.query?.search;
    if (!results || results.length === 0) return null;
    const bestTitle = results[0].title;
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();
    return {
      title: summaryData.title,
      extract: summaryData.extract ? summaryData.extract.slice(0, 500) : null,
      url:
        summaryData.content_urls?.desktop?.page ||
        `https://en.wikipedia.org/wiki/${encodeURIComponent(bestTitle)}`,
    };
  } catch { return null; }
}

async function fetchAllSources(subtasks) {
  const results = await Promise.all(
    subtasks.map(async (task) => {
      const wiki = await searchWikipedia(task);
      return { question: task, wiki };
    })
  );
  return results;
}

// ── STEP 3: Write report ──────────────────────

async function writeReport(originalQuestion, sources) {
  const sourceBlock = sources
    .map((s, i) => {
      const snippet = s.wiki?.extract || "No source available.";
      return `[Source ${i + 1}]\nSub-question: ${s.question}\nContent: ${snippet}`;
    })
    .join("\n\n");

  const messages = [
    {
      role: "system",
      content: `You are an expert research report writer.
- Write a well-structured research report in markdown
- Use ONLY the provided sources — do not invent facts
- Structure: short intro → one ## section per sub-question → conclusion
- Plain clear language, under 500 words
- Do NOT write "According to Wikipedia" or "Source 1 says"`,
    },
    {
      role: "user",
      content: `Original question: "${originalQuestion}"\n\n${sourceBlock}\n\nWrite the research report now.`,
    },
  ];

  return await callLLM(messages);
}

// ── Render source cards ───────────────────────

function renderSubtasks(sources) {
  const list = document.getElementById("subtasks-list");
  list.innerHTML = "";

  sources.forEach((item, i) => {
    const li = document.createElement("li");
    li.style.opacity = "0";
    li.style.transform = "translateY(6px)";
    li.style.transition = `opacity 0.3s ease ${i * 150}ms, transform 0.3s ease ${i * 150}ms`;

    const questionRow = document.createElement("div");
    questionRow.className = "subtask-question";
    const num = document.createElement("span");
    num.className = "subtask-num";
    num.textContent = i + 1;
    const text = document.createElement("span");
    text.className = "subtask-text";
    text.textContent = item.question;
    questionRow.appendChild(num);
    questionRow.appendChild(text);
    li.appendChild(questionRow);

    const card = document.createElement("div");
    if (item.wiki && item.wiki.extract) {
      card.className = "source-card";
      const label = document.createElement("div");
      label.className = "source-label";
      label.textContent = "Wikipedia — " + item.wiki.title;
      const excerpt = document.createElement("div");
      excerpt.className = "source-text";
      excerpt.textContent = item.wiki.extract;
      const link = document.createElement("a");
      link.href = item.wiki.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Read more on Wikipedia";
      card.appendChild(label);
      card.appendChild(excerpt);
      card.appendChild(link);
    } else {
      card.className = "source-card no-source";
      card.textContent = "No Wikipedia article found for this sub-question.";
    }

    li.appendChild(card);
    list.appendChild(li);

    setTimeout(() => {
      li.style.opacity = "1";
      li.style.transform = "translateY(0)";
    }, i * 150);
  });
}

// ── Render report + action buttons ───────────

let currentReportMarkdown = "";

function renderReport(markdownText) {
  currentReportMarkdown = markdownText;
  const reportSection = document.getElementById("report-section");
  const reportOutput  = document.getElementById("report-output");

  reportOutput.innerHTML = marked.parse(markdownText);

  const existingActions = document.getElementById("report-actions");
  if (existingActions) existingActions.remove();

  const actions = document.createElement("div");
  actions.id = "report-actions";
  actions.style.cssText = "display:flex; gap:10px; margin-top:1.25rem; flex-wrap:wrap;";

  const copyBtn = document.createElement("button");
  copyBtn.className = "action-btn";
  copyBtn.textContent = "Copy as markdown";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(markdownText).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy as markdown"; }, 2000);
    }).catch(() => showError("Could not copy — try selecting manually."));
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "action-btn";
  downloadBtn.textContent = "Download .md";
  downloadBtn.onclick = () => {
    const blob = new Blob([markdownText], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = "research-report.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const newBtn = document.createElement("button");
  newBtn.className = "action-btn";
  newBtn.textContent = "New search";
  newBtn.onclick = resetUI;

  actions.appendChild(copyBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(newBtn);
  reportSection.appendChild(actions);
}

// ── Reset UI ──────────────────────────────────

function resetUI() {
  document.getElementById("results").style.display = "none";
  document.getElementById("steps-panel").style.display = "none";
  document.getElementById("subtasks-list").innerHTML = "";
  document.getElementById("report-output").innerHTML = "";
  const actions = document.getElementById("report-actions");
  if (actions) actions.remove();
  document.getElementById("question-input").value = "";
  document.getElementById("question-input").focus();
  currentReportMarkdown = "";
  hideError();
}

// ── Helper: build source title string ────────

function buildSourceTitles(sources) {
  const titles = sources.map((s) => s.wiki?.title).filter(Boolean);
  return titles.length > 0 ? titles.join(" · ") : "no articles found";
}

// ── Main orchestrator ─────────────────────────

async function startResearch() {
  const input    = document.getElementById("question-input");
  const question = input.value.trim();

  if (!question || question.length < 5) {
    showError("Please enter a more detailed question.");
    return;
  }

  hideError();
  document.getElementById("results").style.display = "none";
  document.getElementById("subtasks-list").innerHTML = "";
  document.getElementById("report-output").innerHTML = "";
  const prevActions = document.getElementById("report-actions");
  if (prevActions) prevActions.remove();

  const btn = document.getElementById("search-btn");
  btn.disabled = true;
  btn.textContent = "Researching...";

  document.getElementById("steps-panel").style.display = "flex";
  updateStep("decompose", "pending");
  updateStep("fetch",     "pending");
  updateStep("report",    "pending");

  try {
    // Step 1 — Decompose
    updateStep("decompose", "active", "Asking LLM to break down your question...");
    const subtasks = await decomposeQuestion(question);
    updateStep("decompose", "done", `${subtasks.length} sub-questions generated`);

    document.getElementById("results").style.display = "block";

    // Step 2 — Fetch sources
    updateStep("fetch", "active", "Searching Wikipedia for each sub-question...");
    const sources = await fetchAllSources(subtasks);
    updateStep("fetch", "done", `Wikipedia: ${buildSourceTitles(sources)}`);
    renderSubtasks(sources);

    // Step 3 — Write report
    const sourceWords = sources.map((s) => s.wiki?.extract || "").join(" ").split(" ").length;
    updateStep("report", "active", `Synthesizing ${sourceWords} words of source material...`);
    const report = await writeReport(question, sources);
    const reportWords = report.trim().split(/\s+/).length;
    updateStep("report", "done", `${reportWords} word report written`);
    renderReport(report);

  } catch (err) {
    // Mark the currently-active step as errored
    for (const id of ["decompose", "fetch", "report"]) {
      const el = document.getElementById("step-" + id);
      if (el && el.classList.contains("active")) {
        updateStep(id, "error", err.message);
        break;
      }
    }
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
