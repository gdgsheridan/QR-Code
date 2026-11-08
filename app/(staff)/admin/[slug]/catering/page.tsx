import { Catering } from './catering';

export default async function CateringPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Catering slug={slug} />;
}
