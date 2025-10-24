let questions = [], current = 0, mode = 'review', startTime = 0, userAns = [], pdfItems = [];

const fileInput = document.getElementById('fileInput');
const quizArea = document.getElementById('quizArea');
const resultDiv = document.getElementById('result');

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  let text = ''; pdfItems = [];
  try {
    if (ext === 'pdf') {
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const txt = await page.getTextContent();
        text += txt.items.map(it => it.str).join(' ') + '\n';
        pdfItems = pdfItems.concat(txt.items);
      }
    } else if (ext === 'docx') {
      const ab = await file.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: ab });
      text = res.value;
    } else {
      alert('Chỉ nhận PDF hoặc DOCX'); return;
    }

    questions = parseQuestions(text, pdfItems);
    if (!questions.length) { alert('Không tìm thấy câu hỏi nào'); return; }

    document.getElementById('topBar').classList.remove('hidden');
  } catch (err) {
    alert('Lỗi đọc file: ' + err.message);
  }
});

function parseQuestions(text, pdfItems = []) {
  const QUESTION_RE = /Câu\s*\d+\s*[:.\-)]/gi;
  const blocks = text.split(QUESTION_RE).filter(b => b.trim());
  const out = [];

  blocks.forEach(block => {
    const lines = block.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);
    if (!lines.length) return;

    const question = lines[0];
    const options = [];
    let correct = null;

    let answerLine = null;
    for (const l of lines) {
      const m = l.match(/Đáp\s*án(?:\s*đúng)?[:\-\s]*([A-D])/i);
      if (m) { answerLine = m[1].toUpperCase(); break; }
    }

    if (answerLine) {
      const optLines = lines.slice(1).filter(l => !/Đáp\s*án[:\-\s]*[A-D]/i.test(l));
      optLines.forEach(l => {
        const m = l.match(/^([A-D])\.\s*(.*)/i);
        if (m) options.push(m[2]);
      });
      const idx = answerLine.charCodeAt(0) - 65;
      if (options[idx]) correct = options[idx];
    } else {
      const optLines = lines.slice(1);
      for (const raw of optLines) {
        const star = raw.startsWith('*') || raw.startsWith('•');
        const m = raw.match(/^[\*•]?\s*([A-D])\.\s*(.*)/i);
        if (!m) continue;
        const content = m[2];
        options.push(content);
        if (star) correct = content;
      }
    }

    if (question && options.length >= 2 && correct) {
      out.push({ question, options, correct });
    }
  });
  return out;
}

document.getElementById('startBtn').onclick = () => {
  mode = document.getElementById('modeSelect').value;
  current = 0;
  userAns = Array(questions.length).fill(null);
  shuffle(questions);
  renderProgress();
  showQuestion();
  quizArea.classList.remove('hidden');
  resultDiv.classList.add('hidden');
  document.getElementById('progressContainer').classList.remove('hidden');
  if (mode === 'exam') { startTime = Date.now(); setInterval(updateTimer, 1000); }
};

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

function showQuestion() {
  const q = questions[current];
  document.getElementById('questionTitle').innerHTML = `<strong>Câu ${current + 1}/${questions.length}:</strong> ${q.question}`;
  const optsBox = document.getElementById('options'); optsBox.innerHTML = '';
  q.options.forEach(opt => {
    const lbl = document.createElement('label');
    const checked = userAns[current] === opt ? 'checked' : '';
    lbl.innerHTML = `<input type="radio" name="q" value="${opt}" ${checked}> ${opt}`;
    optsBox.appendChild(lbl);
  });
  document.querySelectorAll('input[name="q"]').forEach(inp => inp.onchange = e => {
    userAns[current] = e.target.value;
    updateProgress();
  });
  updateProgress();
}

document.getElementById('prevBtn').onclick = () => { if (current > 0) { current--; showQuestion(); } };
document.getElementById('nextBtn').onclick = () => { if (current < questions.length - 1) { current++; showQuestion(); } };
document.addEventListener('keydown', e => {
  if (quizArea.classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') document.getElementById('prevBtn').click();
  if (e.key === 'ArrowRight') document.getElementById('nextBtn').click();
});

function renderProgress() {
  const box = document.getElementById('progressBoard');
  box.innerHTML = '';
  questions.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'square';
    d.textContent = i + 1;
    d.onclick = () => { current = i; showQuestion(); };
    box.appendChild(d);
  });
}

function updateProgress() {
  document.querySelectorAll('.square').forEach((s, i) => {
    s.classList.remove('current', 'done', 'wrong');
    if (i === current) s.classList.add('current');
    if (userAns[i]) s.classList.add('done');
  });
  const percent = (userAns.filter(Boolean).length / questions.length) * 100;
  document.getElementById('progressBar').style.width = percent + '%';
}

function updateTimer() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(t / 60)).padStart(2, '0'), s = String(t % 60).padStart(2, '0');
  document.getElementById('timer').textContent = `⏱️ ${m}:${s}`;
}

document.getElementById('submitBtn').onclick = () => {
  if (mode === 'exam' && !confirm('Nộp bài ngay?')) return;
  let score = 0; const wrongs = [];
  questions.forEach((q, i) => { if (userAns[i] === q.correct) score++; else wrongs.push(i); });
  wrongs.forEach(i => document.querySelectorAll('.square')[i].classList.add('wrong'));
  const r = resultDiv;
  r.innerHTML = `✅ Bạn làm đúng: <b>${score}/${questions.length}</b> câu.`;
  if (mode === 'review' && wrongs.length) {
    r.innerHTML += `<br>❌ Câu sai: ${wrongs.map(i => i + 1).join(', ')}. <button onclick="redoWrong()">Làm lại câu sai</button>`;
  }
  r.classList.remove('hidden');
};

function redoWrong() {
  const wrongs = [];
  questions.forEach((q, i) => { if (userAns[i] !== q.correct) wrongs.push(i); });
  if (!wrongs.length) { alert('Không có câu sai'); return; }
  questions = wrongs.map(i => questions[i]);
  userAns = Array(questions.length).fill(null);
  current = 0;
  renderProgress(); showQuestion();
}