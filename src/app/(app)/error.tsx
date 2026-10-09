'use client';

// The page failed to render: say so in place, keep the shell, offer a retry. Details go to the console.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/status';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="anh-main">
      <Banner
        kind="error"
        title="This page could not be loaded"
        actions={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      >
        {error.message || 'Something went wrong on the server.'}
        {error.digest && <span className="anh-code ml-2">{error.digest}</span>}
      </Banner>
    </div>
  );
}
