import Anthropic from "@anthropic-ai/sdk";
import { customTools, executeTool } from "./tools.js";
import { handleMemoryCommand } from "./memory-store.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Bu model string'ini Claude Platform hesabındaki güncel model adına göre
// kontrol et (platform.claude.com/docs -> Models).
const MODEL = "claude-sonnet-5";

// Anthropic-provided tool: config bu kadar, input_schema tanımlamana gerek yok.
const MEMORY_TOOL = { type: "memory_20250818", name: "memory" } as const;

const MAX_TOOL_TURNS = 8;

// Frontend'in localStorage'da tuttuğu thread'den gönderdiği son N mesaj.
// Claude'a gerçek konuşma geçmişini vermek için kullanılır — yoksa her istek
// sıfırdan başlar ve model önceki turu hiç görmez.
const MAX_HISTORY_MESSAGES = 20;

export interface HistoryTurn {
  role: "user" | "coach";
  text: string;
}

export interface CoachInput {
  message: string;
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  history?: HistoryTurn[];
}

// Anthropic API, mesajların user/assistant olarak sırayla dönmesini ve
// user ile başlamasını zorunlu kılıyor. Bozuk bir istekten sonra thread'de
// art arda iki "user" kalmış olabilir (ör. önceki cevap hata verdiyse) —
// bu yüzden art arda gelen aynı-rol mesajları birleştiriyoruz.
function toMessages(
  turns: { role: "user" | "assistant"; content: Anthropic.Messages.ContentBlockParam[] }[]
): Anthropic.Messages.MessageParam[] {
  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const t of turns) {
    const last = messages[messages.length - 1];
    if (last && last.role === t.role && Array.isArray(last.content)) {
      (last.content as Anthropic.Messages.ContentBlockParam[]).push(...t.content);
    } else {
      messages.push({ role: t.role, content: t.content });
    }
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}

export async function runCoachTurn({
  message,
  imageBase64,
  imageMediaType,
  history,
}: CoachInput): Promise<string> {
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];

  if (imageBase64) {
    userContent.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageMediaType ?? "image/jpeg",
        data: imageBase64,
      },
    });
  }
  userContent.push({ type: "text", text: message });

  const historyTurns = (history ?? [])
    .filter(
      (m): m is HistoryTurn =>
        !!m &&
        (m.role === "user" || m.role === "coach") &&
        typeof m.text === "string" &&
        m.text.trim() !== ""
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: (m.role === "coach" ? "assistant" : "user") as "user" | "assistant",
      content: [{ type: "text" as const, text: m.text }],
    }));

  const messages = toMessages([
    ...historyTurns,
    { role: "user", content: userContent },
  ]);

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      // Extended thinking kapalı: açık olduğunda modelin "thinking" bloğu
      // max_tokens bütçesinin tamamını tüketip hiç metin üretmeden
      // kesilebiliyordu (uzun/detaylı mesajlarda boş cevap dönüyordu).
      thinking: { type: "disabled" },
      tools: [MEMORY_TOOL, ...customTools] as Anthropic.Messages.ToolUnion[],
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock && "text" in textBlock ? textBlock.text : "";
    }

    // Modelin tool çağrılarını da içeren cevabını geçmişe ekle.
    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.Messages.ContentBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      let resultText: string;
      try {
        resultText =
          block.name === "memory"
            ? await handleMemoryCommand(block.input as Record<string, any>)
            : await executeTool(block.name, block.input as Record<string, any>);
      } catch (err: any) {
        resultText = `Hata: ${err.message ?? String(err)}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultText,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Üzgünüm, bu isteği tamamlayamadım (çok fazla adım gerekti). Tekrar dener misin?";
}
