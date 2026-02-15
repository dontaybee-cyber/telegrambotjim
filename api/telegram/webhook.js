const TELEGRAM_API = "https://api.telegram.org";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function telegramSendMessage(botToken, chatId, text) {
  const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });
  if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
}

async function callGemini({ apiKey, model, systemPrompt, userText, bookingLink }) {
  // Gemini generateContent supports JSON output mode. :contentReference[oaicite:6]{index=6}
  const url = `${GEMINI_API}/models/${model}:generateContent?key=${apiKey}`;
  const prompt = systemPrompt.replaceAll("{{BOOKING_LINK}}", bookingLink);

  const body = {
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.6
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Gemini failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text.");
  return JSON.parse(text);
}

export default async function handler(request) {
  try {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const BOT_TOKEN = mustEnv("TELEGRAM_BOT_TOKEN");
    const GEMINI_KEY = mustEnv("GEMINI_API_KEY");
    const SYSTEM_PROMPT = mustEnv("AI_SYSTEM_PROMPT");

    const BOOKING_LINK = process.env.BOOKING_LINK || "https://calendly.com/your-link";
    const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    // Optional: verify Telegram secret_token header (recommended). :contentReference[oaicite:7]{index=7}
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== expectedSecret) return new Response("Unauthorized", { status: 401 });
    }

    const update = await request.json();
    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const userText = msg?.text;

    // Ignore non-text messages for MVP
    if (!chatId || !userText) return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });

    const ai = await callGemini({
      apiKey: GEMINI_KEY,
      model: GEMINI_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userText,
      bookingLink: BOOKING_LINK
    });

    const replyText =
      typeof ai?.reply_text === "string" && ai.reply_text.trim()
        ? ai.reply_text.trim()
        : "Got you — what’s your website or IG link so I can take a look?";

    await telegramSendMessage(BOT_TOKEN, chatId, replyText);

    // Later: log ai + update to Sheets/DB
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error(e);
    // Return 200 so Telegram doesn't hammer retries while you're iterating
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
}
