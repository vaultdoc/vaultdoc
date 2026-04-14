import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a prompt through the local `claude` CLI.
 * Uses the user's existing Claude Code auth — no ANTHROPIC_API_KEY needed.
 */
async function ask(prompt: string): Promise<string> {
  const { stdout } = await execFileAsync("claude", [
    "--print",           // non-interactive, print response and exit
    "--output-format", "text",
    prompt,
  ], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024 * 4, // 4 MB
  });
  return stdout.trim();
}

/**
 * Given a change description + current doc content, produce an improved version.
 * Returns updated markdown content only.
 */
export async function improveDoc(
  currentContent: string,
  changeDescription: string,
  docTitle: string
): Promise<string> {
  return ask(`You are a technical documentation assistant.
Update the following document based on the described change.
Rules:
- Keep existing structure unless the change requires restructuring
- Be concise — no filler
- Use markdown: headers, code blocks, bullet points
- Return ONLY the updated markdown content, no explanations

Document title: ${docTitle}

${currentContent ? `Current content:\n\`\`\`markdown\n${currentContent}\n\`\`\`` : "This is a new document."}

Requested change:
${changeDescription}`);
}

/**
 * Summarize what changed between old and new doc content for Slack.
 */
export async function summarizeChange(
  oldContent: string,
  newContent: string,
  docTitle: string
): Promise<string> {
  return ask(`Summarize this documentation change in 1-2 sentences for a Slack notification. Be specific and concise.

Doc: ${docTitle}

Before:
${oldContent.slice(0, 2000)}

After:
${newContent.slice(0, 2000)}`);
}
