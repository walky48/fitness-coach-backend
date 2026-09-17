import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const KEY = "coach:push-subscription";

// PWA, bildirim izni verilince buraya kendi push subscription objesini
// gönderir. Tek kullanıcılı bir proje olduğu için tek bir kayıt tutuyoruz;
// notify endpoint'i (bir sonraki adım) bunu okuyup push gönderecek.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Sadece POST destekleniyor" });
    return;
  }

  const subscription = req.body;
  if (!subscription?.endpoint) {
    res.status(400).json({ error: "Geçersiz push subscription" });
    return;
  }

  await redis.set(KEY, JSON.stringify(subscription));
  res.status(200).json({ ok: true });
}
