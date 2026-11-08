import type { Metadata } from 'next';
import { SharedCatering } from './shared-catering';

// SPEC §11 (v0.11.39): what the organizers' Catering share link opens. Its key lives only in the URL fragment,
// which browsers never send to the server (like /p, I-3).
export const metadata: Metadata = {
  title: 'Catering · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function SharedCateringPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SharedCatering slug={slug} />;
}
