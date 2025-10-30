// File: api/index.js
// Đây là Vercel Serverless function, KHÔNG dùng app.listen()

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import OpenAI from 'openai';

// --- Cấu hình ---
const app = express();

// --- Khởi tạo OpenAI Client ---
// Vercel sẽ tự động nạp OPENAI_API_KEY từ Environment Variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Middleware (Phần mềm trung gian) ---
// Cho phép frontend (từ domain khác) gọi API này
app.use(cors()); 
// Đọc JSON từ body của request
app.use(bodyParser.json());

// --- Định nghĩa các API Routes ---

/**
 * Route 1: /api/ai-parse
 * Nhận toàn bộ text và trả về mảng câu hỏi đã parse
 */
app.post('/api/ai-parse', async (req, res) => {
  const { text, instruction } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Không tìm thấy 'text' trong request body" });
  }

  // Prompt hệ thống (hướng dẫn AI)
  const sysPrompt = instruction || "Bạn là một parser. Từ nội dung sau, trích xuất danh sách câu hỏi trắc nghiệm. Trả về JSON thuần (chỉ JSON, không text thừa): [{\"question\":\"...\",\"options\":[\"...\"],\"correct\": indexOr-1}, ...].";
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Dùng model mới nhất (hoặc "gpt-4o")
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: text }
      ],
      temperature: 0.1, // Giảm độ "sáng tạo" để parsing chính xác
    });

    const reply = completion.choices[0].message.content;
    
    // Cố gắng trích xuất JSON từ text trả về (AI đôi khi trả về ```json ... ```)
    const jsonMatch = reply.match(/\[.*\]/s); // Tìm mảng [ ... ]
    if (!jsonMatch) {
      throw new Error("AI không trả về định dạng JSON array.");
    }

    const parsedQuestions = JSON.parse(jsonMatch[0]);
    res.status(200).json({ questions: parsedQuestions }); // Trả về { questions: [...] }

  } catch (err) {
    console.error("OpenAI Error:", err.message);
    res.status(500).json({ error: "Lỗi từ server AI: " + err.message });
  }
});

/**
 * Route 2: /api/ai-generate-options
 * Nhận 1 câu hỏi (dạng text) và tạo ra các lựa chọn
 */
app.post('/api/ai-generate-options', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "Không tìm thấy 'question' trong request body" });
  }

  const sysPrompt = "Bạn là trợ lý soạn thảo. Cho câu hỏi sau, hãy tạo 4 lựa chọn (A, B, C, D) và xác định đáp án đúng. Trả về JSON (chỉ JSON, không text thừa): {\"options\": [\"A...\", \"B...\", \"C...\", \"D...\"], \"correctIndex\": index (0-3)}.";
  
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: question }
      ],
      response_format: { type: "json_object" }, // Yêu cầu OpenAI trả về JSON
      temperature: 0.2,
    });

    const resultData = JSON.parse(completion.choices[0].message.content);
    // resultData sẽ là { options: [...], correctIndex: 1 }
    res.status(200).json(resultData);

  } catch (err) {
    console.error("OpenAI Error:", err.message);
    res.status(500).json({ error: "Lỗi từ server AI: " + err.message });
  }
});

// --- Xuất app cho Vercel ---
// Vercel sẽ tự động tìm 'export default' này và biến nó thành serverless function
export default app;
