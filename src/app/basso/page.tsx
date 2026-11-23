import type { Metadata } from 'next';
import BassWorkspace from '@/components/local-bass/BassWorkspace';

export const metadata: Metadata = {
  title: 'Studio Basso',
  robots: { index: false, follow: false },
};

export default function BassPage() {
  return <BassWorkspace />;
}
