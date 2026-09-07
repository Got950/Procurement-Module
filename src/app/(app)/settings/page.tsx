import { PageHeader } from "@/components/app/page-header";
import { SettingsForm } from "./settings-form";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your profile and account password."
      />
      <SettingsForm />
    </div>
  );
}
