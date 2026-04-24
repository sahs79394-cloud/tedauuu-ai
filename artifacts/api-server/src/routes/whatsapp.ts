import { Router, type IRouter } from "express";
import { getWaState, getWaQrPng, startWhatsapp } from "../lib/whatsapp.js";

const router: IRouter = Router();

router.get("/wa/status", (_req, res) => {
  const s = getWaState();
  res.json({
    status: s.status,
    connected: s.status === "open",
    me: s.me,
    connectedAt: s.connectedAt,
    hasQr: Boolean(s.qrDataUrl),
    lastError: s.lastError,
  });
});

router.get("/wa/qr.png", async (_req, res) => {
  const s = getWaState();
  if (s.status === "open") {
    res.status(409).json({ error: "Already connected to WhatsApp." });
    return;
  }
  const png = await getWaQrPng();
  if (!png) {
    res.status(503).json({ error: "QR not ready yet, try again in 2 seconds." });
    return;
  }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.send(png);
});

router.get("/wa", (_req, res) => {
  const s = getWaState();
  const refresh = s.status === "open" ? "" : `<meta http-equiv="refresh" content="5">`;

  let body = "";
  if (s.status === "open") {
    body = `
      <h1>✅ Connected!</h1>
      <p>Tedauuu is now live on WhatsApp as <b>${s.me ?? ""}</b>.</p>
      <p>Send a message to this WhatsApp number — Tedauuu will reply automatically. 🤖✨</p>
    `;
  } else if (s.qrDataUrl) {
    body = `
      <h1>📱 Scan to link Tedauuu</h1>
      <p>WhatsApp → <b>Settings → Linked Devices → Link a Device</b></p>
      <img src="${s.qrDataUrl}" width="360" height="360" alt="WhatsApp QR" />
      <p style="opacity:.7">QR refreshes automatically. Status: <b>${s.status}</b></p>
    `;
  } else {
    body = `
      <h1>⏳ Generating QR...</h1>
      <p>Status: <b>${s.status}</b>. This page will refresh in 5 seconds.</p>
    `;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Tedauuu — WhatsApp link</title>${refresh}
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b3d2e;color:#fff;
       min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{background:#fff;color:#0b3d2e;padding:32px 28px;border-radius:24px;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  h1{margin:0 0 12px;font-size:22px}
  img{border-radius:12px;background:#fff;margin:12px 0}
  p{margin:8px 0;line-height:1.4}
</style></head>
<body><div class="card">${body}</div></body></html>`);
});

// kick off WA on first hit too, in case startup didn't
router.get("/wa/start", async (_req, res) => {
  await startWhatsapp();
  res.json({ ok: true });
});

export default router;
