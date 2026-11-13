// Thin AI layer. Ported from TableForge-web (app/src/lib/ai.ts), extended with
// the Ollama provider Jon asked for. Offline is always the fallback: callers
// try aiComplete() and drop back to the offline generators on ANY error.
//
// Settings shape (plain object, supplied by the Foundry-facing code):
//   { anthropicKey: string, claudeModel: string, ollamaUrl: string, ollamaModel: string }

export class AiError extends Error {}

export const aiReady = (s) => Boolean((s?.anthropicKey ?? "").trim() || (s?.ollamaUrl ?? "").trim());

/** Pulls a JSON object out of a model reply, tolerating code fences and stray prose. */
export function parseObject(raw) {
  const t = String(raw ?? "").replace(/```json/g, "").replace(/```/g, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new AiError("The answer wasn't in the expected format. Try again.");
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch {
    throw new AiError("The answer wasn't in the expected format. Try again.");
  }
}

async function completeAnthropic(s, system, user, maxTokens) {
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": s.anthropicKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: (s.claudeModel ?? "").trim() || "claude-sonnet-4-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch {
    throw new AiError("Can't reach Claude. Check the internet connection.");
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* keep raw */ }
    if (res.status === 401) msg = "The API key was rejected. Check it in Settings.";
    if (res.status === 429) msg = "Claude is rate-limiting this key. Wait a moment and try again.";
    throw new AiError(`Claude error ${res.status}: ${msg}`);
  }
  const json = JSON.parse(text);
  return (json.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("");
}

async function completeOllama(s, system, user, maxTokens) {
  const base = s.ollamaUrl.trim().replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: (s.ollamaModel ?? "").trim() || "llama3.1",
        stream: false,
        format: "json",
        options: { num_predict: maxTokens },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    throw new AiError("Can't reach Ollama. Check the URL in Settings.");
  }
  if (!res.ok) throw new AiError(`Ollama error ${res.status}.`);
  const json = await res.json();
  const out = json?.message?.content ?? "";
  if (!out) throw new AiError("Ollama returned nothing.");
  return out;
}

/**
 * Completes a prompt with whichever provider is configured.
 * Priority: Anthropic key first, then Ollama URL (Jon's stated ordering).
 * Throws AiError when nothing is configured or the provider fails.
 */
export async function aiComplete(s, system, user, maxTokens = 3000) {
  if ((s?.anthropicKey ?? "").trim()) return completeAnthropic(s, system, user, maxTokens);
  if ((s?.ollamaUrl ?? "").trim()) return completeOllama(s, system, user, maxTokens);
  throw new AiError("Offline mode has no AI model. Add a Claude API key or an Ollama URL in the module settings.");
}
