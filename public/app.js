// ---------- durum ----------

const STORAGE_KEY = "coach:thread";
let pendingPhoto = null; // { base64, mediaType, previewUrl }

const els = {
  thread: document.getElementById("thread"),
  composer: document.getElementById("composer"),
  input: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  photoInput: document.getElementById("photoInput"),
  pendingPhoto: document.getElementById("pendingPhoto"),
  pendingPhotoPreview: document.getElementById("pendingPhotoPreview"),
  pendingPhotoRemove: document.getElementById("pendingPhotoRemove"),
  quickLog: document.getElementById("quickLog"),
  logMenuBtn: document.getElementById("logMenuBtn"),
  installBanner: document.getElementById("installBanner"),
  installBannerText: document.getElementById("installBannerText"),
  installBannerAction: document.getElementById("installBannerAction"),
  installBannerClose: document.getElementById("installBannerClose"),
};

// ---------- thread render + persist ----------

function loadThread() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveThread(thread) {
  // Fotoğrafları localStorage'da saklamıyoruz (hızlıca doldurur) — sadece metni.
  const trimmed = thread.map(({ role, text }) => ({ role, text }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(-50)));
}

function renderEmptyState() {
  const empty = document.createElement("div");
  empty.className = "thread__empty";
  empty.textContent = "Bugün ne yaptın, ne yiyeceksin, neyi merak ediyorsun — buradan başla.";
  els.thread.appendChild(empty);
}

function appendMessage({ role, text, imageUrl, status }) {
  const msg = document.createElement("div");
  msg.className = `msg msg--${role}${status ? ` msg--${status}` : ""}`;

  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.className = "msg__image";
    img.alt = "Gönderilen fotoğraf";
    msg.appendChild(img);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg__bubble";
  bubble.textContent = text;
  msg.appendChild(bubble);

  els.thread.appendChild(msg);
  els.thread.scrollTop = els.thread.scrollHeight;
  return msg;
}

let thread = loadThread();
if (thread.length === 0) {
  renderEmptyState();
} else {
  for (const m of thread) appendMessage(m);
}

// ---------- composer ----------

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 120) + "px";
}
els.input.addEventListener("input", autoGrow);

els.photoInput.addEventListener("change", () => {
  const file = els.photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64 = dataUrl.split(",")[1];
    pendingPhoto = { base64, mediaType: file.type || "image/jpeg", previewUrl: dataUrl };
    els.pendingPhotoPreview.src = dataUrl;
    els.pendingPhoto.hidden = false;
  };
  reader.readAsDataURL(file);
});

els.pendingPhotoRemove.addEventListener("click", () => {
  pendingPhoto = null;
  els.photoInput.value = "";
  els.pendingPhoto.hidden = true;
});

els.logMenuBtn.addEventListener("click", () => {
  els.quickLog.hidden = !els.quickLog.hidden;
});

els.quickLog.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const kind = btn.dataset.quick;
  const starters = {
    workout: "Bugünkü antrenmanı logla: ",
    meal: "Bu öğünü logla: ",
    metrics: "Bugünkü kilomu/ölçümümü kaydet: ",
    photo: null,
  };
  if (kind === "photo") {
    els.photoInput.click();
  } else {
    els.input.value = starters[kind];
    els.input.focus();
    autoGrow();
  }
  els.quickLog.hidden = true;
});

els.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text && !pendingPhoto) return;

  const userMsg = { role: "user", text: text || "(fotoğraf)", imageUrl: pendingPhoto?.previewUrl };
  appendMessage(userMsg);
  thread.push({ role: "user", text: userMsg.text });
  saveThread(thread);

  const photoToSend = pendingPhoto;
  els.input.value = "";
  autoGrow();
  pendingPhoto = null;
  els.photoInput.value = "";
  els.pendingPhoto.hidden = true;
  els.sendBtn.disabled = true;

  const pendingEl = appendMessage({ role: "coach", text: "…", status: "pending" });

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text || undefined,
        imageBase64: photoToSend?.base64,
        imageMediaType: photoToSend?.mediaType,
      }),
    });
    const data = await res.json();
    pendingEl.remove();
    if (!res.ok) throw new Error(data.error || "Sunucu hatası");

    appendMessage({ role: "coach", text: data.reply });
    thread.push({ role: "coach", text: data.reply });
    saveThread(thread);
  } catch (err) {
    pendingEl.remove();
    appendMessage({ role: "coach", text: `Bağlanamadım: ${err.message}`, status: "error" });
  } finally {
    els.sendBtn.disabled = false;
  }
});

// ---------- service worker + push ----------

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush(registration) {
  if (!("PushManager" in window)) return;
  if (Notification.permission === "denied") return;

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") return;

  const { publicKey } = await fetch("/api/vapid-public-key").then((r) => r.json());
  if (!publicKey) return;

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
}

registerServiceWorker().then((reg) => {
  if (reg) subscribeToPush(reg).catch(() => {});
});

// ---------- ana ekrana ekle banner'ı ----------

const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandalone) showInstallBanner("Bu uygulamayı ana ekranına ekleyebilirsin.", true);
});

function showInstallBanner(text, withAction) {
  if (localStorage.getItem("coach:installBannerDismissed")) return;
  els.installBannerText.textContent = text;
  els.installBannerAction.hidden = !withAction;
  els.installBanner.hidden = false;
}

els.installBannerAction.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBanner.hidden = true;
});

els.installBannerClose.addEventListener("click", () => {
  els.installBanner.hidden = true;
  localStorage.setItem("coach:installBannerDismissed", "1");
});

if (!isStandalone && isIOS) {
  showInstallBanner("Ana ekrana eklemek için Paylaş simgesine, sonra \u201cAna Ekrana Ekle\u201dye dokun.", false);
}
