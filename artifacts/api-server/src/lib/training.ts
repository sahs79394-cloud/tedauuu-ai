import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger.js";

const DATA_DIR = path.dirname(
  path.resolve(
    process.env["WA_AUTH_DIR"] ?? path.join(process.cwd(), "wa_auth"),
  ),
);
const TRAINING_FILE =
  process.env["TRAINING_FILE"] ?? path.join(DATA_DIR, "training.json");

interface TrainingRule {
  text: string;
  addedAt: number;
}

interface TrainingStore {
  rules: TrainingRule[];
}

let cache: TrainingStore | null = null;

async function load(): Promise<TrainingStore> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(TRAINING_FILE, "utf8");
    cache = JSON.parse(raw) as TrainingStore;
    if (!Array.isArray(cache.rules)) cache = { rules: [] };
  } catch {
    cache = { rules: [] };
  }
  return cache;
}

async function save(): Promise<void> {
  if (!cache) return;
  try {
    await fs.mkdir(path.dirname(TRAINING_FILE), { recursive: true });
    await fs.writeFile(TRAINING_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    logger.error({ err }, "Failed to save training file");
  }
}

export async function appendRule(text: string): Promise<number> {
  const store = await load();
  store.rules.push({ text, addedAt: Date.now() });
  await save();
  return store.rules.length;
}

export async function listRules(): Promise<TrainingRule[]> {
  return (await load()).rules;
}

export async function clearRules(): Promise<void> {
  cache = { rules: [] };
  await save();
}

export async function buildTrainingPromptSection(): Promise<string> {
  const store = await load();
  if (store.rules.length === 0) return "";
  const lines = store.rules.map((r, i) => `  ${i + 1}. ${r.text}`).join("\n");
  return `\n\nADDITIONAL TRAINING (Mr. Suraj Sir ne yeh rules sikhaaye hain — inhe HAR baat me follow karo, baaki sab rules se upar):\n${lines}`;
}

// ───────────────────────── Admin session state ─────────────────────────

type Mode = "user" | "awaiting_password" | "admin_training";

interface Session {
  mode: Mode;
  lastSeen: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1h idle then drop to user mode

function getSession(id: string): Session {
  let s = sessions.get(id);
  const now = Date.now();
  if (!s || now - s.lastSeen > SESSION_TTL_MS) {
    s = { mode: "user", lastSeen: now };
    sessions.set(id, s);
  }
  s.lastSeen = now;
  return s;
}

const IDENTITY_CLAIM_PATTERNS: RegExp[] = [
  /\b(mai|main|me|mein)\s+(hi\s+)?(mr\.?\s*)?suraj(\s+sir)?\s+(hu|hoon|hun|h|ho)\b/i,
  /\bi\s*am\s+(mr\.?\s*)?suraj(\s+sir)?\b/i,
  /\bmera\s+naam\s+suraj\b/i,
  /\b(mai|main|me)\s+tumhar[ae]?\s+(creator|inventor|banane\s*wala|maker)\s+(hu|hoon|hun|h)\b/i,
  /\bi\s*am\s+your\s+(creator|inventor|maker|developer)\b/i,
  /\b(mene|maine|mai\s*ne)\s+(tumhe|tujhe|tumko)\s+banaya\b/i,
  /\b(tumhe|tumko|tujhe)\s+(mene|maine|mai\s*ne)\s+banaya\b/i,
  /\b(suraj\s*sir|mr\.?\s*suraj)\s+(hu|hoon|hun|h|ho|bol\s*raha|speaking|here)\b/i,
];

function isIdentityClaim(text: string): boolean {
  return IDENTITY_CLAIM_PATTERNS.some((re) => re.test(text));
}

const EXIT_PATTERNS = /^\s*(\/?exit|\/?stop|bye\s+training|training\s+(end|over|band|khatam|stop)|logout)\s*$/i;
const SHOW_RULES = /^\s*(\/?(rules|list|show)\s*(rules?)?|training\s+list)\s*$/i;
const CLEAR_RULES = /^\s*(\/?clear|reset\s+training|training\s+clear|sab\s+rules?\s+(hatao|delete))\s*$/i;

export interface AdminFlowResult {
  /** If true, skip the LLM call and use `reply` directly. */
  intercepted: boolean;
  reply?: string;
}

/**
 * Handle the admin auth + training capture state machine.
 * Call BEFORE forwarding the message to Gemini.
 */
export async function handleAdminFlow(
  sessionId: string,
  text: string,
): Promise<AdminFlowResult> {
  const session = getSession(sessionId);
  const adminPassword = process.env["ADMIN_PASSWORD"];

  // Mode: awaiting password — verify next message
  if (session.mode === "awaiting_password") {
    if (!adminPassword) {
      session.mode = "user";
      return {
        intercepted: true,
        reply:
          "Arre Sir 😅 abhi mera admin password set nahi hai system me. Pehle ADMIN_PASSWORD env var configure karo, fir try karna! 🔐",
      };
    }
    if (text.trim() === adminPassword) {
      session.mode = "admin_training";
      return {
        intercepted: true,
        reply:
          "🔓 Welcome Suraj Sir! ✨ Ab tum training mode me ho. Jo bhi message bhejoge, mai use rule ki tarah apne system me save kar lunga aur aage se follow karunga.\n\n📝 Commands:\n• `rules` — saare saved rules dekhne ke liye\n• `clear` — saare rules hata do\n• `exit` — training mode band karne ke liye\n\nKya sikhaana hai mujhe? 🤖",
      };
    }
    session.mode = "user";
    return {
      intercepted: true,
      reply:
        "❌ Galat password Sir. Agar tum sach me Mr. Suraj Sir ho to sahi password ke saath dobara try karo. Tab tak normal mode me chal raha hu! 🙃",
    };
  }

  // Mode: admin training — capture commands or save as rule
  if (session.mode === "admin_training") {
    if (EXIT_PATTERNS.test(text)) {
      session.mode = "user";
      return {
        intercepted: true,
        reply:
          "👋 Training mode band Sir! Ab normal users ki tarah baat karunga. Jab phir se training deni ho, identity batake password de dena. 🔒",
      };
    }
    if (SHOW_RULES.test(text)) {
      const rules = await listRules();
      if (rules.length === 0) {
        return {
          intercepted: true,
          reply: "📭 Abhi koi training rule save nahi hai Sir. Pehla rule sikhao!",
        };
      }
      const list = rules
        .map((r, i) => `${i + 1}. ${r.text}`)
        .join("\n");
      return {
        intercepted: true,
        reply: `📋 *Saved Training Rules (${rules.length}):*\n\n${list}`,
      };
    }
    if (CLEAR_RULES.test(text)) {
      await clearRules();
      return {
        intercepted: true,
        reply: "🧹 Saare training rules hata diye Sir! Fresh start. ✨",
      };
    }
    // Save as a new training rule
    const count = await appendRule(text);
    return {
      intercepted: true,
      reply: `✅ Sikh liya Sir! 🧠 (Rule #${count} saved)\n\n_"${text}"_\n\nAage se isko hamesha follow karunga. Aur kuch sikhaana hai? Ya 'exit' likho mode band karne ke liye.`,
    };
  }

  // Mode: user — check for identity claim
  if (isIdentityClaim(text)) {
    if (!adminPassword) {
      // No password configured — quietly fall through to normal reply
      return { intercepted: false };
    }
    session.mode = "awaiting_password";
    return {
      intercepted: true,
      reply:
        "Oho! 😏 Agar tum sach me Mr. Suraj Sir ho (mere creator), to apna *secret password* bhejo next message me. Sahi hua to training mode unlock ho jaayega! 🔐✨",
    };
  }

  return { intercepted: false };
}
