import { ScheduleEditor } from './schedule';

export default async function SchedulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ScheduleEditor slug={slug} />;
}
