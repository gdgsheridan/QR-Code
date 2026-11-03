import { Workshops } from './workshops';

// SPEC §13 (v0.12): workshop analytics (organizers; the layout checks the role).
export default async function WorkshopsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Workshops slug={slug} />;
}
