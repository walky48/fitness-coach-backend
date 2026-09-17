import type { VercelRequest, VercelResponse } from "@vercel/node";

// VAPID public key gizli değil (private key gizli olan), bu yüzden client'a
// açıkça servis etmek güvenli. Anahtarları README'deki adımla üret.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}
