/* =========================================================
   Moon Learn 学 – Ôn & Thi Trắc Nghiệm
   Phiên bản: mammoth (gốc) + thang 10 + tự chuyển câu + chỉ review mới hiện đáp án đúng
   ========================================================= */
let questions   = [],
    current     = 0,
    mode        = 'review',
    startTime   = 0,
    userAns     = [],
    pdfItems    = [];

/* =========================================================
   1. ĐỌC FILE PDF / DOCX – DÙNG MAMMOTH CHO DOCX
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
  try {
    const ab = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: ab });
    const text = res.value;
    questions = parseQuestions(text);
  } catch (err) {
    alert('Lỗi đọc DOCX: ' + err.message);
  }
}

/* =========================================================
   2. TÁCH CÂU HỎI & ĐÁP ÁN – GIỮ NGUYÊN MAMMOTH
   ========================================================= */
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

    /* 2.1 Tìm “Đáp án: B” */
    const answerRegex = /Đáp\s*án[:\-\s]*([A-D])/i;
    let answerLabel = null;
    for (const l of lines) {
      const m = l.match(answerRegex);
      if (m) { answerLabel = m[1].toUpperCase(); break; }
    }

    /* 2.2 Thu gom A. xxx … */
    const optRegex = /^([A-D])[.\s]\s*(.*)/i;
    lines.slice(1).forEach(line => {
      const m = line.match(optRegex);
      if (!m) return;
      const label = m[1].toUpperCase();
      let optText = m[2].trim();

      /* ký tự đầu * hoặc • */
      const star = line.startsWith('*') || line.startsWith('•');
      options.push({ label, text: optText, star });
    });

    if (options.length < 2) return;

    /* 2.3 Xác định đáp án đúng */
    if (answerLabel) {
      const idx = answerLabel.charCodeAt(0) - 65;
      if (options[idx]) correct = options[idx].text;
    } else {
      const target = options.find(o => o.star);
      if (target) correct = target.text;
    }

    if (question && correct) {
      out.push({ question, options: options.map(o => o.text), correct });
    }
  });
  return out;
}

/* =========================================================
   3. KHỞI ĐỘNG THI (KHÔNG ĐỔI)
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
   4. HIỂN THỊ CÂU HỎI – CHỈ REVIEW MỚI HIỆN ĐÁP ÁN ĐÚNG KHI SAI
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

      /* --- CHỈ review mới hiện đúng/sai --- */
      if (mode === 'review') {
        if (e.target.value === q.correct) {
          lbl.classList.add('correct');
        } else {
          lbl.classList.add('wrong');
          /* Hiện luôn đáp án đúng */
          const correctLabel = [...optsBox.querySelectorAll('label')].find(
            l => l.textContent.trim() === q.correct
          );
          if (correctLabel) correctLabel.classList.add('correct');
        }
      }

      updateProgress();

      /* --- Tự động chuyển câu sau 0.6s --- */
      setTimeout(() => {
        if (current < questions.length - 1) {
          current++;
          showQuestion();
        }
      }, 600);
    };

    optsBox.appendChild(lbl);
  });

  updateProgress();
}

/* =========================================================
   5. ĐIỀU HƯỚNG & PHÍM TẮT (KHÔNG ĐỔI)
   ========================================================= */
document.getElementById('prevBtn').onclick = () => { if (current > 0) { current--; showQuestion(); } };
document.getElementById('nextBtn').onclick = () => { if (current < questions.length - 1) { current++; showQuestion(); } };

document.addEventListener('keydown', (e) => {
  if (document.getElementById('quizArea').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') document.getElementById('prevBtn').click();
  if (e.key === 'ArrowRight') document.getElementById('nextBtn').click();
});

/* =========================================================
   6. BẢNG TIẾN TRÌNH (KHÔNG ĐỔI)
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
   7. ĐỒNG HỒ THI (KHÔNG ĐỔI)
   ========================================================= */
function updateTimer() {
  const t = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(t / 60)).padStart(2, '0');
  const s = String(t % 60).padStart(2, '0');
  document.getElementById('timer').textContent = `⏱️ ${m}:${s}`;
}

/* =========================================================
   8. NỘP BÀI – TÍNH ĐIỂM THANG 10 & LÀM LẠI CÂU SAI
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
  const score10 = (score / questions.length * 10).toFixed(1);   // Thang 10
  r.innerHTML = `✅ Bạn làm đúng: <b>${score}/${questions.length}</b> câu.<br>
                 ⭐ Điểm thang 10: <b>${score10}</b>`;
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
