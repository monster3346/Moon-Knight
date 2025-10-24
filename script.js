/* =========================================================
   Moon Learn 学 – Ôn & Thi Trắc Nghiệm
   Phiên bản: đọc DOCX (docx-preview) + PDF (pdf.js)
   Tự động nhận diện đáp án: màu, đậm, nghiêng, gạch, *, •, "Đáp án: B"
   ========================================================= */
let questions   = [],
    current     = 0,
    mode        = 'review',
    startTime   = 0,
    userAns     = [],
    pdfItems    = [];

/* ---------- 0. Khối ẩn chứa DOCX render ---------- */
const hiddenDiv = document.createElement('div');
hiddenDiv.style.display = 'none';
document.body.appendChild(hiddenDiv);

/* =========================================================
   1. Đọc file PDF / DOCX
   ========================================================= */
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'pdf') await readPDF(file);
    else if (ext === 'docx') await readDOCX(file);
    else { alert('Chỉ nhận PDF hoặc DOCX'); return; }

    if (!questions.length) { alert('Không tìm thấy câu hỏi nào'); return; }
    document.getElementById('topBar').classList.remove('hidden');
  } catch (err) {
    alert('Lỗi đọc file: ' + err.message);
  }
});

async function readPDF(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text = '', items = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const txt = await page.getTextContent();
    text += txt.items.map(it => it.str).join(' ') + '\n';
    items = items.concat(txt.items);
  }
  questions = parseQuestions(text, items);
}

async function readDOCX(file) {
  const ab = await file.arrayBuffer();
  await docx.renderAsync(ab, hiddenDiv);
  const text = hiddenDiv.innerText || hiddenDiv.textContent || '';
  questions = parseQuestions(text);
}

/* =========================================================
   2. TÁCH & NHẬN DIỆN CÂU HỎI + ĐÁP ÁN
   ========================================================= */
function parseQuestions(text, pdfItems = []) {
  text = text.replace(/\r/g, '\n');
  const rawLines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);

  /* ----- 2.1 Tách khối “Câu ...” ----- */
  const QUESTION_RE = /Câu\s*\d+\s*[:.)\-]/gi;
  const blocks = text.split(QUESTION_RE).filter(b => b.trim());
  const out = [];

  blocks.forEach(block => {
    const blockLines = block.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l);
    if (!blockLines.length) return;
    const question = blockLines[0];
    const options = [];               // [{label:'A', text:'xxx', style:{}}]
    let correct = null;

    /* ----- 2.2 Tìm “Đáp án: B” (ưu tiên cao nhất) ----- */
    const answerRegex = /Đáp\s*án\s*(đúng)?\s*[:–—\-]\s*([A-D])/i;
    let answerLabel = null;
    for (const l of blockLines) {
      const m = l.match(answerRegex);
      if (m) { answerLabel = m[2].toUpperCase(); break; }
    }

    /* ----- 2.3 Thu gom A. xxx, B. xxx … ----- */
    const optRegex = /^([A-D])[.\s]\s*(.*)/i;
    blockLines.slice(1).forEach(line => {
      const m = line.match(optRegex);
      if (!m) return;
      const label = m[1].toUpperCase();
      let optText = m[2].trim();

      /* a) style HTML (docx-preview) */
      let bold = false, italic = false, underline = false, color = null;
      if (line.includes('<b>') || line.includes('strong')) bold = true;
      if (line.includes('<i>') || line.includes('em')) italic = true;
      if (line.includes('<u>') || line.includes('text-decoration:underline')) underline = true;
      const colorM = line.match(/color[:=]\s*([^";)\s]+)/i);
      if (colorM) color = colorM[1].toLowerCase();

      /* b) ký tự đầu * hoặc • */
      const star = line.startsWith('*') || line.startsWith('•');

      /* c) PDF: trích transform / fontName / color */
      if (pdfItems.length) {
        const it = pdfItems.find(it => it.str === optText);
        if (it) {
          if (it.transform && it.transform.join('').includes('Bold')) bold = true;
          if (it.fontName && it.fontName.toLowerCase().includes('bold')) bold = true;
          if (it.color) {
            const rgb = it.color.map(c => Math.round(c * 255).toString(16).padStart(2, '0'));
            color = `#${rgb.join('')}`;
          }
        }
      }

      options.push({ label, text: optText, bold, italic, underline, color, star });
    });

    if (options.length < 2) return;

    /* ----- 2.4 Xác định đáp án đúng ----- */
    if (answerLabel) {
      const found = options.find(o => o.label === answerLabel);
      if (found) correct = found.text;
    } else {
      const colors = options.map(o => o.color).filter(Boolean);
      const uniqueColor = colors.length
        ? colors.find(c => colors.indexOf(c) === colors.lastIndexOf(c))
        : null;
      const target = options.find(o =>
        o.star || o.color === uniqueColor || o.bold || o.italic || o.underline
      );
      if (target) correct = target.text;
    }

    if (question && correct) {
      out.push({ question, options: options.map(o => o.text), correct });
    }
  });
  return out;
}

/* =========================================================
   3. KHỞI ĐỘNG THI
   ========================================================= */
document.getElementById('startBtn').onclick = () => {
  mode = document.getElementById('modeSelect').value;
  current = 0;
  userAns = Array(questions.length).fill(null);
  shuffle(questions);
  renderProgress();
  showQuestion();
  document.getElementById('quizArea').classList.remove('hidden');
  document.getElementById('result').classList.add('hidden');
  document.getElementById('progressContainer').classList.remove('hidden');
  if (mode === 'exam') { startTime = Date.now(); setInterval(updateTimer, 1000); }
};

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/* =========================================================
   4. HIỂN THỊ CÂU HỎI
   ========================================================= */
function showQuestion() {
  const q = questions[current];
  document.getElementById('questionTitle').innerHTML = `<strong>Câu ${current + 1}/${questions.length}:</strong> ${q.question}`;
  const optsBox = document.getElementById('options');
  optsBox.innerHTML = '';

  q.options.forEach(opt => {
    const lbl = document.createElement('label');
    const checked = userAns[current] === opt ? 'checked' : '';
    lbl.innerHTML = `<input type="radio" name="q" value="${opt}" ${checked}> ${opt}`;

    lbl.querySelector('input').onchange = (e) => {
      userAns[current] = e.target.value;
      optsBox.querySelectorAll('label').forEach(l => l.classList.remove('correct', 'wrong'));
      if (mode === 'review') {
        if (e.target.value === q.correct) lbl.classList.add('correct');
        else lbl.classList.add('wrong');
      }
      updateProgress();
    };
    optsBox.appendChild(lbl);
  });

  updateProgress();
}

/* =========================================================
   5. ĐIỀU HƯỚNG & PHÍM TẮT
   ========================================================= */
document.getElementById('prevBtn').onclick = () => { if (current > 0) { current--; showQuestion(); } };
document.getElementById('nextBtn').onclick = () => { if (current < questions.length - 1) { current++; showQuestion(); } };

document.addEventListener('keydown', (e) => {
  if (document.getElementById('quizArea').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') document.getElementById('prevBtn').click();
  if (e.key === 'ArrowRight') document.getElementById('nextBtn').click();
});

/* =========================================================
   6. BẢNG TIẾN TRÌNH
   ========================================================= */
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
    if (userAns[i]) {
      s.classList.add('done');
      if (mode === 'review' && userAns[i] !== questions[i].correct) s.classList.add('wrong');
    }
  });
  const percent = (userAns.filter(Boolean).length / questions.length) * 100;
  document.getElementById('progressBar').style.width = percent + '%';
}

/* =========================================================
   7. ĐỒNG HỒ THI
   ========================================================= */
function updateTimer() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  document.getElementById('timer').textContent = `⏱️ ${m}:${s}`;
}

/* =========================================================
   8. NỘP BÀI & LÀM LẠI CÂU SAI
   ========================================================= */
document.getElementById('submitBtn').onclick = () => {
  if (mode === 'exam' && !confirm('Nộp bài ngay?')) return;
  let score = 0;
  const wrongs = [];
  questions.forEach((q, i) => {
    if (userAns[i] === q.correct) score++;
    else wrongs.push(i);
  });
  wrongs.forEach(i => document.querySelectorAll('.square')[i].classList.add('wrong'));

  const r = document.getElementById('result');
  r.innerHTML = `✅ Bạn làm đúng: <b>${score}/${questions.length}</b> câu.`;
  if (mode === 'review' && wrongs.length) {
    r.innerHTML += `<br>❌ Câu sai: ${wrongs.map(i => i + 1).join(', ')}. 
                    <button onclick="redoWrong()">Làm lại câu sai</button>`;
  }
  r.classList.remove('hidden');
};

function redoWrong() {
  const wrongs = [];
  questions.forEach((q, i) => { if (userAns[i] !== q.correct) wrongs.push(i); });
  if (!wrongs.length) { alert('Không có câu sai'); return; }
  questions = wrongs.map(i => questions[i]);
  userAns   = Array(questions.length).fill(null);
  current   = 0;
  renderProgress();
  showQuestion();
}
