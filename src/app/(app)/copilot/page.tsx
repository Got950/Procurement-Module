import { CopilotPanel } from "@/components/copilot/copilot-panel";
import { PageHeader } from "@/components/app/page-header";

export default function CopilotPage() {
  return (
    <div className="flex h-[calc(100vh-var(--header-height)-3.5rem)] min-h-[32rem] flex-col gap-4 md:h-[calc(100vh-var(--header-height)-2rem)]">
      <PageHeader
        title="Procurement Copilot"
        description="Ask about indents, quotations, approvals, and workflow status. Actions that change data require your confirmation and follow the same rules as the rest of the application."
        className="shrink-0"
      />
      <div className="app-surface min-h-0 flex-1 overflow-hidden">
        <CopilotPanel />
      </div>
    </div>
  );
}
