'use client';

import { Coop } from '@/components/Coop';
import { Guard } from '@/components/Guard';

export default function Home() {
  return (
    <Guard>
      <Coop />
    </Guard>
  );
}
