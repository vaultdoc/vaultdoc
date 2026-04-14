import { IncomingWebhook } from "@slack/webhook";
import type { KnownBlock } from "@slack/types";

const webhookUrl = process.env.SLACK_WEBHOOK_URL ?? "";
const teamName = process.env.TEAM_NAME ?? "Team";

let webhook: IncomingWebhook | null = null;
if (webhookUrl) {
  webhook = new IncomingWebhook(webhookUrl);
}

export async function notifyDocUpdated(
  docPath: string,
  docTitle: string,
  updatedBy: string,
  summary: string,
  action: "created" | "updated" | "deleted"
) {
  if (!webhook) return;

  const emoji = action === "created" ? ":sparkles:" : action === "deleted" ? ":wastebasket:" : ":pencil2:";
  const verb = action === "created" ? "created" : action === "deleted" ? "deleted" : "updated";

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *[${teamName} Docs]* \`${docTitle}\` was ${verb} by *${updatedBy}*`,
      },
    },
  ];

  if (summary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: summary },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Path: \`${docPath}\`` }],
  });

  await webhook.send({
    text: `${emoji} *[${teamName} Docs]* \`${docTitle}\` was ${verb} by *${updatedBy}*`,
    blocks,
  });
}
