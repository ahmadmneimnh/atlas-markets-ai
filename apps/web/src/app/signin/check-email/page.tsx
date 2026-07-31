import Link from 'next/link';

import { Card } from '@/components/primitives';

export const metadata = { title: 'Check your email · Atlas Markets AI' };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <Card className="p-8 text-center">
        <h1 className="gold-text text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 text-sm text-ink-muted">
          A sign-in link is on its way. It expires in 15 minutes and works once.
        </p>
        <p className="mt-4 text-xs text-ink-faint">
          Nothing arrived? Check spam, then request another link — the previous one stops working as
          soon as a new one is issued.
        </p>
        <Link href="/signin" className="mt-6 inline-block text-sm text-gold hover:underline">
          ← Back to sign in
        </Link>
      </Card>
    </main>
  );
}
