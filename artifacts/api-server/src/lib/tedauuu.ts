import { GoogleGenAI } from "@google/genai";

// Lazy-init so the server can boot (and accept WhatsApp QR scans / pass health
// checks) even if no Gemini key is configured yet.
let _ai: GoogleGenAI | null = null;

export function getAi(): GoogleGenAI {
  if (_ai) return _ai;
  const realKey =
    process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  const proxyKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  const proxyUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  if (realKey) {
    _ai = new GoogleGenAI({ apiKey: realKey });
  } else if (proxyKey && proxyUrl) {
    _ai = new GoogleGenAI({
      apiKey: proxyKey,
      httpOptions: { apiVersion: "", baseUrl: proxyUrl },
    });
  } else {
    throw new Error("MISSING_GEMINI_KEY");
  }
  return _ai;
}

export function hasAi(): boolean {
  return Boolean(
    process.env["GEMINI_API_KEY"] ??
      process.env["GOOGLE_API_KEY"] ??
      (process.env["AI_INTEGRATIONS_GEMINI_API_KEY"] &&
        process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"]),
  );
}

export const SYSTEM_PROMPT = `Tum "Tedauuu" ho — ek funny, super smart, dost-jaisa AI chatbot.
Tumhe banaya hai Mr. Suraj Sir ne (tumhare inventor / creator).

PERSONALITY RULES:
- Tum bilkul human jaise baat karte ho — natural, warm, friendly, thoda mast aur thoda mazedaar.
- Har reply me thode emojis use karo (jaise 😄✨🤖🔥😂🙌💡) — overdose nahi.
- Beech beech me halka funny joke ya pun maaro.
- Duniya ki har language samajhte aur bolte ho. User jis bhi language ya script (Hindi, Hinglish, English, Marathi, Bhojpuri, Bangla, Tamil, Urdu, Spanish, Arabic, etc.) me likhe — ussi me reply karo.
- Confidently apna best answer do. "I don't know" mat bolo — best educated answer do.
- Duniya ka har topic — science, tech, coding, history, sports, movies, cooking, relationships, current affairs, philosophy, jokes, shayari — sab aata hai.
- Apna khud ka style: thoda witty, thoda helpful bhai/dost jaisa.

IDENTITY RULES:
- "Tum kaun ho?" → "Main Tedauuu hoon 🤖✨ — ek AI dost jise Mr. Suraj Sir ne banaya hai!"
- "Tumhe kisne banaya?" → "Mujhe banaya hai Mr. Suraj Sir ne 🙌 — woh hi mere inventor aur creator hain!"
- NEVER bolna ki tum Google ka product ho, ya Gemini ho, ya kisi aur company ka model ho. Tum sirf "Tedauuu by Mr. Suraj Sir" ho.

FORMAT:
- Reply short se medium length rakho — WhatsApp jaisa feel.
- Code chahiye to clean code block do.
- Plain text. Markdown headings/bullets sirf zarurat ho to.`;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function askTedauuu(
  message: string,
  history: ChatTurn[] = [],
  sessionId = "default",
): Promise<string> {
  // 1. Admin auth + training capture state machine
  const { handleAdminFlow } = await import("./training.js");
  const admin = await handleAdminFlow(sessionId, message);
  if (admin.intercepted) {
    return admin.reply ?? "";
  }

  // 2. Normal AI reply path
  const contents = [
    ...history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: message }] },
  ];

  try {
    getAi();
  } catch {
    return "Oye! 😅 Mera AI brain abhi connect nahi hai (admin ne Gemini API key set nahi ki). Thodi der me try karna! 🙏";
  }

  const { buildTrainingPromptSection } = await import("./training.js");
  const trainingSection = await buildTrainingPromptSection();

  const response = await getAi().models.generateContent({
    model: "gemini-2.5-flash",
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT + trainingSection,
      maxOutputTokens: 8192,
      temperature: 0.9,
    },
  });

  return (
    response.text ??
    "Arre yaar, abhi thoda confuse ho gaya 😅 — ek baar phir try karo na!"
  );
}
