// ─────────────────────────────────────────────
// Research Agent — Day 3
// Wikipedia source cards with links + better search
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

// ── JSON parser with fallbacks ────────────────

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

// ── Step 1: Decompose ─────────────────────────

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
    if (Array.isArray(parsed) && parsed.length === 3 && parsed.every(s => typeof s === "string" && s.trim().length > 0)) {
      return parsed.map(s => s.trim());
    }
    return null;
  } catch { return null; }
}

async function tryDecomposeStrict(question) {
  const messages = [
    { role: "user", content: `Break "What is artificial intelligence?" into 3 sub-questions. Reply with only a JSON array.` },
    { role: "assistant", content: `["What is the definition and history of artificial intelligence?", "How do AI systems learn and make decisions?", "What are the main applications and impacts of AI today?"]` },
    { role: "user", content: `Break "${question}" into 3 sub-questions. Reply with only a JSON array.` },
  ];
  try {
    const raw = await callLLM(messages);
    const parsed = parseJSON(raw);
    if (Array.isArray(parsed) && parsed.length >= 2 && parsed.every(s => typeof s === "string" && s.trim().length > 0)) {
      return parsed.slice(0, 4).map(s => s.trim());
    }
    return null;
  } catch { return null; }
}

// ── Step 2: Wikipedia search — NEW & IMPROVED ─

// Strategy: use Wikipedia's search API first to find the best matching
// article title, then fetch its summary. Much more reliable than guessing.

async function searchWikipedia(query) {
  // Step A: search for the best matching article title
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;

  try {
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    const results = searchData?.query?.search;
    if (!results || results.length === 0) return null;

    const bestTitle = results[0].title;

    // Step B: fetch the summary for that title
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();

    return {
      title: summaryData.title,
      extract: summaryData.extract ? summaryData.extract.slice(0, 500) : null,
      url: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(bestTitle)}`,
    };
  } catch {
    return null;
  }
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

// ── Step 3: Write the report ─────────────────

async function writeReport(originalQuestion, sources) {
  const sourceText = sources
    .map((s, i) => {
      const src = s.wiki ? s.wiki.extract : "No source found.";
      return `Sub-question ${i + 1}: ${s.question}\nSource: ${src}`;
    })
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

// ── Render sub-questions with source cards ────

function renderSubtasks(sources) {
  const list = document.getElementById("subtasks-list");
  list.innerHTML = "";

  sources.forEach((item, i) => {
    const li = document.createElement("li");
    li.style.opacity = "0";
    li.style.transform = "translateY(6px)";
    li.style.transition = `opacity 0.3s ease ${i * 150}ms, transform 0.3s ease ${i * 150}ms`;

    // Question row
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

    // Source card
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

    // Trigger animation
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

  if (!question || question.length < 5) {
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
    // Step 1: Decompose
    setStep("decompose", "active");
    const subtasks = await decomposeQuestion(question);
    setStep("decompose", "done");

    // Show results area early so cards animate in during fetch
    document.getElementById("results").style.display = "block";

    // Step 2: Fetch sources
    setStep("fetch", "active");
    const sources = await fetchAllSources(subtasks);
    setStep("fetch", "done");

    // Render sub-questions + source cards together
    renderSubtasks(sources);

    // Step 3: Write report
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
