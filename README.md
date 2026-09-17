# Fitness Coach — Backend + PWA

Claude API'yi çağıran backend ve ana ekrana eklenebilen PWA arayüzü, tek
Vercel projesinde birlikte.

## Mimari

```
public/            <- PWA (statik dosyalar, Vercel otomatik servis eder)
  index.html         chat arayüzü
  app.js             chat mantığı, fotoğraf yükleme, push aboneliği
  sw.js              service worker: app-shell cache + push bildirimleri
  manifest.json      ana ekrana ekleme meta verisi
  icons/             192/512 ikon (yer tutucu — istersen kendi ikonunla değiştir)

api/
  chat.ts             POST -> runCoachTurn() -> Claude (tool-use loop)
  subscribe.ts        push subscription'ı Redis'e kaydeder
  vapid-public-key.ts client'a public VAPID key'i verir

lib/
  claude-client.ts    Claude tool-use döngüsü
  memory-store.ts     memory tool -> Redis (profil, hedefler, tercihler)
  tools.ts            custom tools -> Redis (günlük antrenman/öğün/ölçüm logları)
```

Vercel serverless fonksiyonları her istekte sıfırdan başlar (stateless),
bu yüzden kalıcı hafıza için ücretsiz bir Upstash Redis kullanıyoruz.

## Kurulum

1. **Bağımlılıklar**
   ```bash
   npm install
   ```

2. **Claude API key**
   platform.claude.com/dashboard -> Settings -> API Keys -> Create key.
   (Daha önce başka bir projen için aldığın key'i de kullanabilirsin.)

3. **Upstash Redis** (ücretsiz tier yeterli)
   upstash.com üzerinden bir Redis veritabanı oluştur, "REST URL" ve
   "REST TOKEN" değerlerini al.

4. `.env.example` dosyasını `.env` olarak kopyala ve değerleri doldur:
   ```bash
   cp .env.example .env
   ```

5. **Yerelde test et**
   ```bash
   npx vercel dev
   ```
   Sonra başka bir terminalde:
   ```bash
   curl -X POST http://localhost:3000/api/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "Bugün göğüs-triceps günüm, ne önerirsin?"}'
   ```

6. **Deploy**
   Repo'yu GitHub'a push et, Vercel'de "Import Project" ile bağla.
   Vercel dashboard -> Settings -> Environment Variables kısmına
   `.env` içindeki üç değişkeni ekle. Sonraki her `git push` otomatik
   deploy tetikler.

## PWA'yı ana ekrana ekleme

**Android (Chrome):** Siteyi açtığında uygulama otomatik olarak
"Yükle" banner'ı gösterir (`app.js` içindeki `beforeinstallprompt`
dinleyicisi). Dokunduğunda ikon ana ekrana eklenir.

**iOS (Safari):** Apple native bir yükleme isteği göstermiyor, bu yüzden
uygulama kendi banner'ında yönlendirme yapıyor: Paylaş simgesi ->
"Ana Ekrana Ekle". Bir kere eklendikten sonra tam ekran, tarayıcı
çubuğu olmadan açılır.

Push bildirimleri her iki platformda da yalnızca **ana ekrana eklendikten
sonra** çalışır (iOS 16.4+ şartı) — tarayıcı sekmesinde açıkken izin
verilse bile bildirim gelmez.

## VAPID anahtarları (push bildirimleri için)

```bash
npx web-push generate-vapid-keys
```
Çıkan `Public Key` ve `Private Key` değerlerini `.env`'e yaz. Uygulama
ana ekrana eklenip açıldığında otomatik olarak bildirim izni ister ve
`/api/subscribe`'a kendi push subscription'ını gönderir — bunu Redis'te
`coach:push-subscription` altında görebilirsin.

Bu adımda subscription'ı **kaydediyoruz** ama henüz **göndermiyoruz** —
gerçek push gönderimi (`web-push` paketiyle) ve günlük tetikleyen GitHub
Actions cron workflow'u sıradaki adım.

## Fotoğraf analizi nasıl çalışır

Frontend'den fotoğrafı base64'e çevirip `imageBase64` alanıyla gönder:
```json
{
  "message": "Bu haftaki ilerleme fotoğrafımı önceki haftalarla kıyasla",
  "imageBase64": "<base64 string>",
  "imageMediaType": "image/jpeg"
}
```
Claude görseli doğrudan analiz eder; ayrıca isterse `get_recent_logs`
aracıyla son antrenman/beslenme verini çekip fotoğraftaki değişimi
bağlama oturtur.

## Sırada ne var

- `api/notify.ts`: Redis'teki push subscription'ı okuyup `web-push`
  paketiyle gerçek bildirim gönderen endpoint.
- `.github/workflows/`: bu endpoint'i günlük/haftalık tetikleyen cron
  workflow'u (GitHub Actions).
- İlk kullanımda profilini (hedefler, ekipman listesi, mevcut makro
  hedeflerin) `/memories/profile.md` altına yazması için Claude'a
  tanıtıcı bir mesaj göndermek — bundan sonra her konuşmada hatırlayacak.

## Notlar

- `memory` tool'u (type: `memory_20250818`) beta'dan yeni GA'ya geçti;
  alan isimleri (`insert_line`, `new_str` vb.) ileride küçük değişebilir.
  `lib/memory-store.ts` içindeki `pick()` yardımcıları buna karşı esnek
  bırakıldı, ama ilk testte gerçek `tool_use.input` çıktısını bir kez
  loglayıp doğrulaman iyi olur.
- Model adı (`claude-sonnet-5`) hesabındaki güncel isimle eşleşmiyorsa
  `lib/claude-client.ts` içinden güncelle.
