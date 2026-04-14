import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Given a raw change description + current doc content, produce an improved
 * version of the documentation. Returns the updated markdown content only.
 */
export async function improveDoc(
  currentContent: string,
  changeDescription: string,
  docTitle: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: `You are a technical documentation assistant for a software engineering team.
Your job is to update and improve documentation based on described changes.
Rules:
- Keep existing structure unless the change requires restructuring
- Be concise — no filler, no preamble
- Use markdown: headers, code blocks, bullet points
- Preserve any existing sections that are not affected by the change
- Return ONLY the updated markdown content, no explanations`,
    messages: [
      {
        role: "user",
        content: `Document title: ${docTitle}

Current content:
\`\`\`markdown
${currentContent}
\`\`\`

Requested change:
${changeDescription}

Return the updated markdown content.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("No text response from AI");
  return text.text.trim();
}

/**
 * Summarize what changed between old and new doc content for the Slack notification.
 */
export async function summarizeChange(
  oldContent: string,
  newContent: string,
  docTitle: string
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: "You summarize documentation changes in 1-2 sentences for a Slack update. Be specific and concise.",
    messages: [
      {
        role: "user",
        content: `Doc: ${docTitle}

Before:
${oldContent.slice(0, 2000)}

After:
${newContent.slice(0, 2000)}

Summarize the change in 1-2 sentences.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return "Documentation updated.";
  return text.text.trim();
}
