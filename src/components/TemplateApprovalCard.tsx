"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { TemplateType } from "@/contexts/chat-context";

interface ActionRequest {
  name: string;
  args: { templateType?: TemplateType; reasoning?: string };
  description?: string;
}

interface HITLRequest {
  actionRequests: ActionRequest[];
  reviewConfigs: Array<{ actionName: string; allowedDecisions: string[] }>;
}

interface TemplateApprovalCardProps {
  request: HITLRequest;
  onApprove: () => void;
  onEdit: (templateType: TemplateType) => void;
  disabled?: boolean;
}

const TEMPLATE_LABEL: Record<TemplateType, { name: string; tagline: string; emoji: string }> = {
  nextjs: { name: "Next.js Web App", tagline: "UI, dashboard, landing page, internal tool", emoji: "🌐" },
  n8n: { name: "n8n Workflow", tagline: "Automation, schedules, webhooks, integrations", emoji: "🔗" },
};

export function TemplateApprovalCard({ request, onApprove, onEdit, disabled }: TemplateApprovalCardProps) {
  const setTemplateAction = request.actionRequests.find((a) => a.name === "set_template");
  const proposed = (setTemplateAction?.args.templateType ?? "nextjs") as TemplateType;
  const reasoning = setTemplateAction?.args.reasoning;
  const description = setTemplateAction?.description;
  const [busy, setBusy] = useState(false);

  if (!setTemplateAction) return null;

  const wrap = (fn: () => void) => () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      fn();
    } finally {
      // The parent unmounts this card on resume; clearing here is just a fallback.
      setTimeout(() => setBusy(false), 1500);
    }
  };

  const other: TemplateType = proposed === "nextjs" ? "n8n" : "nextjs";

  return (
    <Card className="p-4 border-amber-300/50 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-700/50">
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0">{TEMPLATE_LABEL[proposed].emoji}</div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <div className="text-sm font-medium">
              I&apos;ll build this as a {TEMPLATE_LABEL[proposed].name}
            </div>
            <div className="text-xs text-muted-foreground">
              {TEMPLATE_LABEL[proposed].tagline}
            </div>
            {reasoning && (
              <div className="text-xs text-muted-foreground mt-1.5 italic">
                {reasoning}
              </div>
            )}
            {description && !reasoning && (
              <div className="text-xs text-muted-foreground mt-1.5">{description}</div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={wrap(onApprove)} disabled={busy || disabled}>
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={wrap(() => onEdit(other))}
              disabled={busy || disabled}
            >
              Switch to {TEMPLATE_LABEL[other].name}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
