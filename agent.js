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
// Every call to Groq goes through here.
// We POST a messages array and get back a string.

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
// LLMs don't always return clean JSON.
// Strategy 1: direct parse
// Strategy 2: strip markdown fences ```json ... ```
// Strategy 3: extract first [...] found in text

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

// ── STEP 1: Decompose the question ───────────
// Sends the user's question to Groq.
// Gets back a JSON array of 3 sub-questions.
// Has a retry mechanism if first attempt fails.

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

// ── STEP 2: Fetch Wikipedia sources ──────────
// Two-step search: find best article title first,
// then fetch its summary. More reliable than
// converting the sub-question directly to a URL.

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
  // Promise.all runs all 3 fetches in parallel — faster than one by one
  const results = await Promise.all(
    subtasks.map(async (task) => {
      const wiki = await searchWikipedia(task);
      return { question: task, wiki };
    })
  );
  return results;
}

// ── STEP 3: Write the report — DAY 4 FOCUS ───
//
// CONCEPT: Prompt chaining
// We take everything gathered so far and feed it
// into one final LLM call:
//   - Original question (context)
//   - 3 sub-questions (structure)
//   - 3 Wikipedia snippets (grounding facts)
//
// The system prompt acts like a brief to a writer:
// "Here is your topic, here are your sources,
//  here is the format. Now write."
//
// The more specific your instructions, the more
// predictable and useful the output.

async function writeReport(originalQuestion, sources) {
  // Build a numbered source block so the LLM
  // knows which source maps to which sub-question
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
You will receive a question, its sub-questions, and source content for each.

Your job:
- Write a well-structured research report in markdown
- Use ONLY the provided sources — do not invent facts
- Structure the report EXACTLY like this:
  1. Short intro paragraph (2-3 sentences giving context)
  2. One section per sub-question with a ## heading
  3. Short conclusion paragraph summarising the key insight
- Use plain, clear language — no jargon
- Keep the total report under 500 words
- Do NOT write phrases like "According to Wikipedia" or "Source 1 says"
  — just write the content naturally as a flowing report`,
    },
    {
      role: "user",
      content: `Original question: "${originalQuestion}"\n\n${sourceBlock}\n\nWrite the research report now.`,
    },
  ];

  return await callLLM(messages);
}

// ── Render source cards ───────────────────────
// Called after sources are fetched.
// Builds each sub-question + Wikipedia card
// with a staggered fade-in animation.

function renderSubtasks(sources) {
  const list = document.getElementById("subtasks-list");
  list.innerHTML = "";

  sources.forEach((item, i) => {
    const li = document.createElement("li");
    li.style.opacity = "0";
    li.style.transform = "translateY(6px)";
    li.style.transition = `opacity 0.3s ease ${i * 150}ms, transform 0.3s ease ${i * 150}ms`;

    // Question row with number badge
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

    // Wikipedia source card
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

    // Trigger animation after element is in DOM
    setTimeout(() => {
      li.style.opacity = "1";
      li.style.transform = "translateY(0)";
    }, i * 150);
  });
}

// ── Render report — DAY 4 FOCUS ──────────────
//
// CONCEPT: Markdown rendering with marked.js
// The LLM returns raw markdown text like:
//   "## What is climate change?\nSome text here..."
// Without rendering, ## shows as literal characters.
// marked.parse() converts it to real HTML:
//   "<h2>What is climate change?</h2><p>Some text...</p>"
// We then inject that HTML into the report div.
//
// CONCEPT: Clipboard API
// navigator.clipboard.writeText() copies any string
// to the system clipboard. It's async (returns a
// Promise) so we use .then() to update the button
// text once the copy is confirmed.
//
// CONCEPT: Blob download for Markdown export
// We create a Blob (binary large object) from the
// markdown string, generate a temporary URL for it,
// simulate a click on a hidden <a> tag, then clean
// up the URL. This triggers a browser file download
// with zero server involvement.

// Store the raw markdown so export functions can use it
let currentReportMarkdown = "";

function renderReport(markdownText) {
  // Save raw markdown for export buttons
  currentReportMarkdown = markdownText;

  const reportSection = document.getElementById("report-section");
  const reportOutput = document.getElementById("report-output");

  // Convert markdown → HTML and inject into page
  reportOutput.innerHTML = marked.parse(markdownText);

  // Remove any existing action buttons from a previous search
  const existingActions = document.getElementById("report-actions");
  if (existingActions) existingActions.remove();

  // Build action buttons row
  const actions = document.createElement("div");
  actions.id = "report-actions";
  actions.style.cssText =
    "display:flex; gap:10px; margin-top:1.25rem; flex-wrap:wrap;";

  // ── Button 1: Copy as Markdown ──
  const copyBtn = document.createElement("button");
  copyBtn.className = "action-btn";
  copyBtn.textContent = "Copy as markdown";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(markdownText).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy as markdown";
      }, 2000);
    }).catch(() => {
      showError("Could not copy — try selecting the text manually.");
    });
  };

  // ── Button 2: Download as .md file ──
  const downloadBtn = document.createElement("button");
  downloadBtn.className = "action-btn";
  downloadBtn.textContent = "Download .md";
  downloadBtn.onclick = () => {
    // Create a Blob from the markdown string
    const blob = new Blob([markdownText], { type: "text/markdown" });
    // Generate a temporary URL pointing to that blob
    const url = URL.createObjectURL(blob);
    // Create a hidden link, click it, then clean up
    const a = document.createElement("a");
    a.href = url;
    a.download = "research-report.md";
    a.click();
    URL.revokeObjectURL(url); // free memory
  };

  // ── Button 3: New search ──
  const newBtn = document.createElement("button");
  newBtn.className = "action-btn";
  newBtn.textContent = "New search";
  newBtn.onclick = resetUI;

  actions.appendChild(copyBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(newBtn);
  reportSection.appendChild(actions);
}

// ── Reset UI to initial state ─────────────────

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

// ── Main orchestrator ─────────────────────────
// This function runs the full agent loop:
// 1. Validate input
// 2. Reset UI state
// 3. Run each step in sequence using await
// 4. Update the step UI before and after each await
// 5. Render output progressively as steps complete

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
  const prevActions = document.getElementById("report-actions");
  if (prevActions) prevActions.remove();

  const btn = document.getElementById("search-btn");
  btn.disabled = true;
  btn.textContent = "Researching...";

  document.getElementById("steps-panel").style.display = "flex";
  setStep("decompose", "pending");
  setStep("fetch", "pending");
  setStep("report", "pending");

  try {
    // ── Step 1: Decompose ──
    // Set active BEFORE await so spinner shows immediately
    setStep("decompose", "active");
    const subtasks = await decomposeQuestion(question);
    setStep("decompose", "done");

    // Show results area so source cards can animate in
    document.getElementById("results").style.display = "block";

    // ── Step 2: Fetch Wikipedia sources ──
    setStep("fetch", "active");
    const sources = await fetchAllSources(subtasks);
    setStep("fetch", "done");

    // Render source cards immediately — don't wait for report
    renderSubtasks(sources);

    // ── Step 3: Write report ──
    setStep("report", "active");
    const report = await writeReport(question, sources);
    setStep("report", "done");

    // Render report + action buttons
    renderReport(report);

  } catch (err) {
    showError("Something went wrong: " + err.message);
    console.error(err);
  } finally {
    // Always re-enable the button whether success or failure
    btn.disabled = false;
    btn.textContent = "Research";
  }
}

// Allow Enter key to trigger research
document.getElementById("question-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") startResearch();
});
