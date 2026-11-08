import { PageHeader } from '../page-header';
import { Downloads } from './downloads';
import { ImportCsv } from './import-csv';

// §11 Tools (v0.12.4, owner's request): every CSV in and out of the admin lives here, nowhere else.
export default async function ToolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <div className="grid gap-[24px] min-w-0 pb-[32px]">
      <PageHeader title="Tools" description="Import applicants from the Sheet, and download your event data as CSV files." />
      <ImportCsv slug={slug} />
      <Downloads slug={slug} />
    </div>
  );
}
