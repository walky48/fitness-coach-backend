import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runCoachTurn } from "../lib/claude-client.js";

// PWA (veya curl/Postman) buraya POST atacak:
// { "message": "...", "imageBase64": "...", "imageMediaType": "image/jpeg" }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Sadece POST destekleniyor" });
    return;
  }

  const { message, imageBase64, imageMediaType } = req.body ?? {};

  if (!message && !imageBase64) {
    res.status(400).json({ error: "message veya imageBase64 alanlarından biri gerekli" });
    return;
  }

  try {
    const reply = await runCoachTurn({
      message: message ?? "Bu ilerleme fotoğrafını analiz eder misin?",
      imageBase64,
      imageMediaType,
    });
    res.status(200).json({ reply });
  } catch (err: any) {
    console.error("chat handler error:", err);
    res.status(500).json({ error: err.message ?? "Sunucu hatası" });
  }
}
