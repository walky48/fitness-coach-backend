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

export interface CoachInput {
  message: string;
  imageBase64?: string;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export async function runCoachTurn({
  message,
  imageBase64,
  imageMediaType,
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

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userContent },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
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
