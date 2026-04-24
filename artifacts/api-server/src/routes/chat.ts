import { Router, type IRouter } from "express";
import { askTedauuu, type ChatTurn } from "../lib/tedauuu.js";

const router: IRouter = Router();

interface ChatRequestBody {
  message?: unknown;
  history?: unknown;
  sessionId?: unknown;
}

function isHistoryItem(value: unknown): value is ChatTurn {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v["role"] === "user" || v["role"] === "assistant") &&
    typeof v["content"] === "string"
  );
}

router.post("/chat", async (req, res) => {
  try {
    const body = (req.body ?? {}) as ChatRequestBody;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      res.status(400).json({ error: "message field is required (string)." });
      return;
    }

    const history: ChatTurn[] = Array.isArray(body.history)
      ? body.history.filter(isHistoryItem)
      : [];

    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : (req.ip ?? "web-default");

    const reply = await askTedauuu(message, history, sessionId);

    res.json({ reply, name: "Tedauuu", creator: "Mr. Suraj Sir" });
  } catch (err) {
    req.log.error({ err }, "chat endpoint failed");
    res.status(500).json({
      error: "Tedauuu thoda thak gaya 😴 — ek baar dobara try karo!",
    });
  }
});

router.get("/", (_req, res) => {
  res.json({
    name: "Tedauuu",
    creator: "Mr. Suraj Sir",
    tagline: "Duniya ka sabse cool AI dost 🤖✨",
    endpoints: {
      chat: "POST /api/chat  body: { message, history? }",
      whatsappQrPage: "GET /api/wa  (open in browser to scan QR)",
      whatsappQrPng: "GET /api/wa/qr.png",
      whatsappStatus: "GET /api/wa/status",
      health: "GET /api/healthz",
    },
  });
});

export default router;
