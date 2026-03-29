import { ImportUploader } from "@/components/import-uploader";
import { PageHeader } from "@/components/ui/page-header";

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data Pipeline"
        title="Import IBKR files through a polished review workflow."
        description="Preview mappings, validate structure, and commit imports with the exact same backend processing you already trust."
      />
      <ImportUploader />
    </div>
  );
}
