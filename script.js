/*
  moonlearn-script-and-ai-backend.js
  ----------------------------------
  This file contains two parts bundled together for convenience:
  1) Client-side: script.js (drop-in replacement for your existing script.js)
  2) Server-side: server.js (Node/Express example for /api/ai-parse and /api/ai-generate-options)

  IMPORTANT
  - Do NOT expose OPENAI_API_KEY in client JS. Use the server.js backend to keep the key secret.
  - Save the client part as `script.js` in your web project and the server part as `server.js` in your backend project.
  - Install dependencies for server: `npm install express cors body-parser openai` (or use the deploy platform's recommended setup).

  ---------------------- PART 1: script.js (client) ----------------------
*/

// ===== script.js =====

/*
  Paste this content into your site's `script.js` (replace the old file).
  This client handles multi-format upload, parsing and optionally calls the backend AI endpoints.
*/

const fileInput = document.getElementById("fileInput");
const hiddenDocx = document.getElementById("hiddenDocx");
const quizArea = document.getElementById("quizArea");
const topBar = document.getElementById("topBar");
const progressContainer = document.getElementById("progressContainer");

if (window['pdfjsLib']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

function normalizeText(s) {
  return s.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/\u00A0/g, " ").trim();
}

function stripRtf(rtf) {
  try {
    rtf = rtf.replace(/\\u(-?\d+)\??/g, (m, p1) => {
      const code = parseInt(p1, 10);
      if (!isNaN(code)) return String.fromCharCode(code);
      return "";
    });
  } catch(e) {}
  return rtf.replace(/\\[a-z]+\d* ?/gi, "")
            .replace(/{\\\*[^}]+}/g, "")
            .replace(/{|}/g, "")
            .replace(/\\'([0-9a-f]{2})/gi, (m, hex) => { return String.fromCharCode(parseInt(hex, 16)); })
            .replace(/\\par[d]?/gi, "\n")
            .replace(/\n\s+\n/g, "\n\n");
}

async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return await extractTextFromPdf(file);
  if (name.endsWith(".docx")) return await extractTextFromDocx(file);
  if (name.endsWith(".rtf")) return await extractTextFromRtf(file);
  if (name.endsWith(".txt")) return await extractTextFromTxt(file);
  if (name.endsWith(".doc")) return await extractTextFromDoc(file);
  throw new Error("Định dạng không được hỗ trợ: " + file.name);
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map(i => i.str);
    fullText += strings.join(" ") + "\n\n";
  }
  return normalizeText(fullText);
}

async function extractTextFromDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const res = await mammoth.extractRawText({ arrayBuffer });
    return normalizeText(res.value);
  } catch (err) {
    try {
      const container = document.createElement("div");
      await docx.renderAsync(arrayBuffer, container);
      const txt = container.textContent || "";
      return normalizeText(txt);
    } catch (e) {
      throw new Error("Không thể đọc DOCX: " + (err.message || err));
    }
  }
}

async function extractTextFromRtf(file) {
  const txt = await file.text();
  const stripped = stripRtf(txt);
  return normalizeText(stripped);
}

async function extractTextFromTxt(file) {
  return normalizeText(await file.text());
}

async function extractTextFromDoc(file) {
  try {
    const raw = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: false }).decode(raw); }
    catch(e) { text = String.fromCharCode(...new Uint8Array(raw)); }
    const nullRatio = (text.match(/\0/g) || []).length / Math.max(1, text.length);
    if (nullRatio > 0.1) throw new Error("File .doc có thể là nhị phân (không thể đọc đáng tin cậy). Hãy convert sang .docx hoặc dùng AI fallback.");
    return normalizeText(text.replace(/[^\x09\x0A\x0D\x20-\x7E\u0080-\uFFFF]/g, ""));
  } catch (e) {
    throw new Error("Không thể đọc .doc: " + e.message);
  }
}

function parseQuestionsFromText(text) {
  text = normalizeText(text);
  text = text.replace(/\r\n/g, "\n").replace(/\n{2,}/g, "\n\n");

  const splitPattern = /(?:^|\n)(?=(?:\s*(?:Câu(?: hỏi)?|Question|Q|Ques|Q\.)\s*\d+[:\.\)]|\s*\d+\s*[:\.\)]))/gi;
  const rawBlocks = text.split(splitPattern).map(b => b.trim()).filter(Boolean);
  const blocks = rawBlocks.length ? rawBlocks : text.split(/\n{2,}/);

  const questions = [];
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i].trim();
    if (!block) continue;
    block = block.replace(/^(?:Câu(?: hỏi)?|Question|Q|Ques|Q\.)\s*\d+[:\)\.\s-]*/i, "").trim();
    block = block.replace(/^\d+\s*[:\)\.\-]?\s*/i, "").trim();
    const lines = block.split(/\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let title = lines[0];
    let optionStartIndex = 1;
    const optionRegex = /^([A-Fa-f]|\d+)\[?\]?[\.]?\)?\s*(.+?)(\s*(\*|\[x\]|\(x\)|✅)?)\s*$/;
    for (let li = 1; li < lines.length; li++) {
      if (lines[li].match(/^([A-Fa-f]|\d+)[\.\)]\s*/)) { optionStartIndex = li; break; }
      if (lines[li].match(optionRegex)) { optionStartIndex = li; break; }
      title += " " + lines[li];
      optionStartIndex = li + 1;
    }
    const options = []; let correctIndex = -1;
    for (let li = optionStartIndex; li < lines.length; li++) {
      const l = lines[li];
      let m = l.match(/^([A-Fa-f])[[\.]\)]\s*(.+?)(\s*(\*|\[x\]|\(x\)|✅)?)\s*$/);
      if (m) { const txt = m[2].trim(); const mark = (m[4] || "").trim(); options.push(txt); if (mark && (mark === "*" || /\[x\]|\(x\)|✅/.test(mark))) correctIndex = options.length - 1; continue; }
      m = l.match(/^(\d+)[\.\)]\s*(.+?)(\s*(\*|\[x\]|✅)?)\s*$/);
      if (m) { const txt = m[2].trim(); const mark = (m[4] || "").trim(); options.push(txt); if (mark && (mark === "*" || /\[x\]|\(x\)|✅/.test(mark))) correctIndex = options.length - 1; continue; }
      let ansMatch = l.match(/^(?:Đáp án|Đ\/A|Answer|Ans|Kết quả)\s*[:\-]\s*([A-Fa-f]|\d+)/i);
      if (ansMatch) { const token = ansMatch[1].toString(); if (/[A-Fa-f]/.test(token)) correctIndex = token.toUpperCase().charCodeAt(0)-65; else { const idx = parseInt(token,10)-1; if (!isNaN(idx)) correctIndex = idx; } continue; }
      ansMatch = l.match(/[→=>]\s*([A-Fa-f]|\d)/);
      if (ansMatch) { const token = ansMatch[1]; if (/[A-Fa-f]/.test(token)) correctIndex = token.toUpperCase().charCodeAt(0)-65; else correctIndex = parseInt(token,10)-1; continue; }
    }
    if (options.length === 0) {
      const maybeOpts = block.split(/(?:\n|;|\/)\s*/).filter(Boolean);
      if (maybeOpts.length >= 2 && maybeOpts.length <= 10) {
        const candidateOpts = maybeOpts.slice(1);
        if (candidateOpts.length >= 2) candidateOpts.forEach(o => options.push(o.trim()));
      }
    }
    if (options.length > 0) {
      if (correctIndex < 0 || correctIndex >= options.length) {}
      questions.push({ number: questions.length+1, question: title.trim(), options, correct: correctIndex });
    } else {
      questions.push({ number: questions.length+1, question: block.trim(), options: [], correct: -1 });
    }
  }
  return questions;
}

function renderParsedPreview(parsedQuestions, rawText) {
  topBar.classList.remove("hidden");
  progressContainer.classList.remove("hidden");
  quizArea.classList.remove("hidden");
  quizArea.innerHTML = "";

  const rawPre = document.createElement("pre"); rawPre.style.maxHeight = "200px"; rawPre.style.overflow = "auto"; rawPre.textContent = rawText;
  const rawBox = document.createElement("div"); rawBox.innerHTML = "<h3>Preview - Nội dung thô</h3>"; rawBox.appendChild(rawPre); quizArea.appendChild(rawBox);

  const parsedBox = document.createElement("div"); parsedBox.innerHTML = "<h3>Preview - Kết quả parsing</h3>"; parsedBox.className = "parsedBox";
  parsedQuestions.forEach((q, idx) => {
    const qDiv = document.createElement("div"); qDiv.className = "parsedQuestion"; qDiv.style.border = "1px solid #ddd"; qDiv.style.padding = "8px"; qDiv.style.margin = "8px 0";
    const titleInput = document.createElement("textarea"); titleInput.value = q.question; titleInput.rows = 2; titleInput.style.width = "100%";
    const optsDiv = document.createElement("div"); optsDiv.style.marginTop = "6px";
    q.options.forEach((opt, oi) => {
      const optRow = document.createElement("div"); optRow.style.display = "flex"; optRow.style.gap = "8px"; optRow.style.marginBottom = "6px";
      const label = document.createElement("input"); label.type = "text"; label.value = opt; label.style.flex = "1";
      const radio = document.createElement("input"); radio.type = "radio"; radio.name = "correct-" + idx; radio.checked = (q.correct === oi);
      radio.addEventListener("change", () => { parsedQuestions[idx].correct = oi; });
      optRow.appendChild(radio); optRow.appendChild(label); optsDiv.appendChild(optRow);
      label.addEventListener("input", (e) => { parsedQuestions[idx].options[oi] = e.target.value; });
    });
    if (q.options.length === 0) {
      const makeMcqBtn = document.createElement("button"); makeMcqBtn.textContent = "Tạo lựa chọn (gợi ý AI)";
      makeMcqBtn.addEventListener("click", async () => {
        makeMcqBtn.disabled = true; makeMcqBtn.textContent = "Đang tạo...";
        try {
          const aiRes = await callAiFallbackGenerateOptions(q.question);
          if (aiRes && aiRes.options && aiRes.options.length) {
            parsedQuestions[idx].options = aiRes.options; parsedQuestions[idx].correct = (aiRes.correctIndex != null) ? aiRes.correctIndex : -1; renderParsedPreview(parsedQuestions, rawText);
          } else alert("AI không tạo được lựa chọn.");
        } catch (err) { alert("Lỗi khi gọi AI: " + (err.message || err)); }
        finally { makeMcqBtn.disabled = false; makeMcqBtn.textContent = "Tạo lựa chọn (gợi ý AI)"; }
      });
      optsDiv.appendChild(makeMcqBtn);
    }
    qDiv.appendChild(document.createTextNode("Câu " + (idx+1) + ": ")); qDiv.appendChild(titleInput); qDiv.appendChild(optsDiv); parsedBox.appendChild(qDiv);
    titleInput.addEventListener("input", (e) => { parsedQuestions[idx].question = e.target.value; });
  });

  const finalizeBtn = document.createElement("button"); finalizeBtn.textContent = "Xác nhận & Lưu (Export JSON)"; finalizeBtn.style.marginTop = "12px";
  finalizeBtn.addEventListener("click", () => {
    const validated = parsedQuestions.map(q => ({ question: q.question, options: q.options, correct: q.correct }));
    const blob = new Blob([JSON.stringify(validated, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "parsed-questions.json"; a.click(); URL.revokeObjectURL(url);
  });

  parsedBox.appendChild(finalizeBtn); quizArea.appendChild(parsedBox);
}

async function callAiFallback(text) {
  const payload = { text, instruction: "Trích xuất danh sách câu hỏi trắc nghiệm từ nội dung sau. Trả về JSON: [{question:'', options:['...'], correct: indexOr-1}]" };
  const res = await fetch("/api/ai-parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("AI backend trả lỗi: " + res.status);
  const data = await res.json(); return data; // expected { questions: [...] }
}

async function callAiDirectOpenAI(text) {
  const apiKey = prompt("Dán OpenAI API key vào đây (CHỈ DÙNG CHO TEST - không an toàn):");
  if (!apiKey) throw new Error("Không có API key");
  const prompt = `Bạn là một parser. Từ nội dung sau, trích xuất danh sách câu hỏi trắc nghiệm (multiple choice). Trả về JSON thuần: [{"question":"...","options":["..."],"correct": indexOr-1}, ...]. Nội dung:\n\n${text}`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1500, temperature: 0.0 })
  });
  if (!resp.ok) { const t = await resp.text(); throw new Error("OpenAI lỗi: " + t); }
  const j = await resp.json(); const reply = j.choices?.[0]?.message?.content;
  try { const jsonStart = reply.indexOf("["); const jsonStr = reply.slice(jsonStart); return JSON.parse(jsonStr); } catch (e) { throw new Error("AI trả về không parse được JSON: " + e.message); }
}

async function callAiFallbackGenerateOptions(questionText) {
  try {
    const res = await fetch("/api/ai-generate-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: questionText }) });
    if (res.ok) { const data = await res.json(); return data; }
  } catch (e) {}
  throw new Error("AI generation không khả dụng. Hãy cấu hình backend AI hoặc dùng OpenAI trực tiếp (chỉ test).");
}

fileInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  let combinedText = "";
  for (let f of files) {
    try { const txt = await extractTextFromFile(f); combinedText += `\n\n---FILE: ${f.name}---\n\n` + txt + "\n\n"; }
    catch (err) { const proceed = confirm(`Không đọc được file "${f.name}": ${err.message}\nBạn có muốn bỏ qua file này và tiếp tục không?`); if (!proceed) return; continue; }
  }
  const parsed = parseQuestionsFromText(combinedText);
  const unknownCount = parsed.filter(q => q.correct === -1).length;
  if (unknownCount > 0) {
    const doAi = confirm(`Phát hiện ${unknownCount} câu chưa xác định đáp án. Bạn có muốn thử AI fallback để dò đáp án/chuẩn hóa (yêu cầu mạng/API)?`);
    if (doAi) {
      try {
        const aiRes = await callAiFallback(combinedText);
        if (aiRes && aiRes.questions && aiRes.questions.length) { renderParsedPreview(aiRes.questions, combinedText); return; }
      } catch (err) { alert("AI fallback thất bại: " + (err.message || err)); }
    }
  }
  renderParsedPreview(parsed, combinedText);
});


/* ---------------------- PART 2: server.js (Node/Express sample) ----------------------
   Save the code below as `server.js` in a separate Node project. Set environment variable
   OPENAI_API_KEY on the server. This exposes two example endpoints:
     POST /api/ai-parse  -> receives { text, instruction } and returns { questions: [...] }
     POST /api/ai-generate-options -> receives { question } and returns { options: [...], correctIndex }

   Install: npm install express cors body-parser openai
*/

// ===== server.js =====

/*
  Simple Node/Express server example using the official OpenAI Node client.
  NOTE: adapt model and prompt according to your quota and needs.
*/

// server.js

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));

const openaiKey = process.env.OPENAI_API_KEY;
if (!openaiKey) {
  console.warn('Warning: OPENAI_API_KEY not set. AI endpoints will fail until you set this env var.');
}
const client = new OpenAI({ apiKey: openaiKey });

app.post('/api/ai-parse', async (req, res) => {
  try {
    const { text, instruction } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });
    const system = instruction || 'Trích xuất câu hỏi trắc nghiệm. Trả về JSON thuần.';
    const prompt = `Bạn là parser. ${system}\n\nNội dung:\n${text}\n\nHãy trả về JSON: [{"question":"...","options":["..."],"correct": indexOr-1}, ...]`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0
    });
    const reply = completion.choices?.[0]?.message?.content || '';
    // attempt to extract JSON array from reply
    const first = reply.indexOf('[');
    const jsonText = first >= 0 ? reply.slice(first) : reply;
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (e) {
      // fallback: ask model to return JSON only
      return res.status(500).json({ error: 'AI trả về không phải JSON. Nội dung: ' + reply });
    }
    res.json({ questions: parsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.post('/api/ai-generate-options', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Missing question' });
    const prompt = `Từ câu hỏi sau, đề xuất 4 lựa chọn (A-D) và chỉ ra đáp án đúng. Trả về JSON: { options: [..], correctIndex: n }\n\nQuestion: ${question}`;
    const completion = await client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 500, temperature: 0.0 });
    const reply = completion.choices?.[0]?.message?.content || '';
    const first = reply.indexOf('{');
    const jsonText = first >= 0 ? reply.slice(first) : reply;
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (e) { return res.status(500).json({ error: 'AI trả về không phải JSON. Nội dung: ' + reply }); }
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AI proxy server listening on port ${PORT}`));

/*
  ---------------------- Deployment notes ----------------------
  - Locally: set OPENAI_API_KEY and run `node server.js`.
    e.g. (mac/linux): export OPENAI_API_KEY="sk-..." && node server.js
  - Deploy to Vercel/Render/Heroku: set OPENAI_API_KEY in the platform env vars, push code.
  - Configure CORS origin to limit to your website domain for security.

  ---------------------- End of bundle ----------------------
*/
