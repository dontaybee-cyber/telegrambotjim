const TELEGRAM_API = "https://api.telegram.org";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

/* =========================
   Environment Helper
========================= */
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/* =========================
   Telegram Sender
========================= */
async function telegramSendMessage(botToken, chatId, text) {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${err}`);
  }
}

/* =========================
   Gemini Call (JIM_API_KEY Direct)
========================= */
async function callGemini(userText, bookingLink) {
  const JIM_API_KEY = mustEnv("JIM_API_KEY");
  const SYSTEM_PROMPT = mustEnv("AI_SYSTEM_PROMPT");
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = SYSTEM_PROMPT.replaceAll("{{BOOKING_LINK}}", bookingLink);

  const res = await fetch(
    `${GEMINI_API}/models/${GEMINI_MODEL}:generateContent?key=${JIM_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: prompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userText }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.6
        }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!raw) throw new Error("Gemini returned empty response.");

  // Safer JSON parsing
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON from Gemini:", raw);
    throw new Error("Gemini returned malformed JSON.");
  }
}

/* =========================
   Webhook Handler
========================= */
export default async function handler(request) {
  try {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const BOT_TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
    const BOOKING_LINK =
      process.env.BOOKING_LINK || "https://calendly.com/your-link";

    // Optional Telegram webhook verification
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const receivedSecret = request.headers.get(
        "x-telegram-bot-api-secret-token"
      );
      if (receivedSecret !== expectedSecret) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const update = await request.json();
    const message = update?.message;
    const chatId = message?.chat?.id;
    const userText = message?.text;

    if (!chatId || !userText) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200
      });
    }

    const ai = await callGemini(userText, BOOKING_LINK);

    const replyText =
      typeof ai?.reply_text === "string" && ai.reply_text.trim()
        ? ai.reply_text.trim()
        : "Quick question — what’s your website or IG link so I can take a look?";

    await telegramSendMessage(BOT_TOKEN, chatId, replyText);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200
    });

  } catch (err) {
    console.error("Webhook Error:", err);
    // Return 200 so Telegram doesn’t flood retries while debugging
    return new Response(JSON.stringify({ ok: true }), {
      status: 200
    });
  }
}
