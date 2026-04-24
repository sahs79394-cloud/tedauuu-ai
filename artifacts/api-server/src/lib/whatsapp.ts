import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import path from "node:path";
import fs from "node:fs/promises";
import { askTedauuu, type ChatTurn } from "./tedauuu.js";
import { logger } from "./logger.js";

// Allow overriding via env (e.g. Railway volume mounted at /data)
const AUTH_DIR = path.resolve(
  process.env["WA_AUTH_DIR"] ?? path.join(process.cwd(), "wa_auth"),
);
const QR_PNG_PATH = path.join(AUTH_DIR, "qr.png");

interface State {
  status: "starting" | "qr" | "connecting" | "open" | "closed";
  qrDataUrl: string | null;
  qrText: string | null;
  lastError: string | null;
  connectedAt: number | null;
  me: string | null;
}

const state: State = {
  status: "starting",
  qrDataUrl: null,
  qrText: null,
  lastError: null,
  connectedAt: null,
  me: null,
};

export function getWaState(): State {
  return state;
}

export async function getWaQrPng(): Promise<Buffer | null> {
  try {
    return await fs.readFile(QR_PNG_PATH);
  } catch {
    return null;
  }
}

const conversations = new Map<string, ChatTurn[]>();
const HISTORY_LIMIT = 12;

function pushTurn(jid: string, role: ChatTurn["role"], content: string) {
  const arr = conversations.get(jid) ?? [];
  arr.push({ role, content });
  while (arr.length > HISTORY_LIMIT) arr.shift();
  conversations.set(jid, arr);
}

function extractText(msg: proto.IMessage | null | undefined): string {
  if (!msg) return "";
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    ""
  ).trim();
}

let socket: WASocket | null = null;
let starting = false;

export async function startWhatsapp(): Promise<void> {
  if (starting || socket) return;
  starting = true;

  await fs.mkdir(AUTH_DIR, { recursive: true });

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const waLogger = pino({ level: "warn" });

  socket = makeWASocket({
    version,
    auth: authState,
    logger: waLogger,
    printQRInTerminal: false,
    browser: ["Tedauuu", "Chrome", "1.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: true,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.status = "qr";
      state.qrText = qr;
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, {
          width: 600,
          margin: 2,
        });
        await QRCode.toFile(QR_PNG_PATH, qr, { width: 700, margin: 3 });
        logger.info("WhatsApp QR generated — scan it from Linked Devices");
      } catch (err) {
        logger.error({ err }, "Failed to render WA QR");
      }
    }

    if (connection === "connecting") {
      state.status = "connecting";
    }

    if (connection === "open") {
      state.status = "open";
      state.connectedAt = Date.now();
      state.qrDataUrl = null;
      state.qrText = null;
      state.me = socket?.user?.id ?? null;
      try {
        await fs.unlink(QR_PNG_PATH);
      } catch {
        /* ignore */
      }
      logger.info({ me: state.me }, "WhatsApp connected!");
    }

    if (connection === "close") {
      state.status = "closed";
      const code =
        (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode ?? 0;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.lastError = lastDisconnect?.error?.message ?? "closed";
      logger.warn(
        { code, loggedOut, err: lastDisconnect?.error?.message },
        "WhatsApp connection closed",
      );

      socket = null;
      starting = false;

      if (loggedOut) {
        // wipe auth so a fresh QR is shown next start
        try {
          await fs.rm(AUTH_DIR, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }

      // auto-reconnect
      setTimeout(() => {
        startWhatsapp().catch((e) =>
          logger.error({ err: e }, "WA restart failed"),
        );
      }, 2500);
    }
  });

  socket.ev.on("messages.upsert", async (m) => {
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      try {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // ignore status broadcasts
        if (jid === "status@broadcast") continue;

        const text = extractText(msg.message);
        if (!text) continue;

        const history = conversations.get(jid) ?? [];

        const reply = await askTedauuu(text, history, jid);

        pushTurn(jid, "user", text);
        pushTurn(jid, "assistant", reply);

        await socket?.sendMessage(jid, { text: reply });
      } catch (err) {
        logger.error({ err }, "Failed to handle WA message");
      }
    }
  });

  starting = false;
}
