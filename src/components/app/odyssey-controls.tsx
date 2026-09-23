'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { makeOdysseyToken, turnOffOdysseyScript } from '@/app/(app)/settings/actions';
import { buildOdysseyUserscript, ODYSSEY_SCRIPT_FILE } from '@/lib/sources/odyssey-script';

/** Settings, Integrations: the Odyssey userscript, built here with the token filled in. */
export function OdysseyControls({ appUrl, token }: { appUrl: string; token: string | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? 'Something went wrong.');
      else {
        toast.success(done);
        router.refresh();
      }
    });
  }

  if (!token) {
    return (
      <div>
        <Button className="h-11 sm:h-9" disabled={isPending} onClick={() => run(makeOdysseyToken, 'Userscript ready to download')}>
          {isPending ? 'Making token' : 'Turn on the userscript'}
        </Button>
      </div>
    );
  }

  const script = buildOdysseyUserscript(appUrl, token);

  function download() {
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = ODYSSEY_SCRIPT_FILE;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        The script holds a private token that lets it add exam rows to your Inbox, so don&apos;t share it. If it leaks, make a new
        token and download the script again; the old one stops working.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 sm:h-8" onClick={download}>
          Download userscript
        </Button>
        <Button
          variant="outline"
          className="h-11 sm:h-8"
          onClick={() =>
            navigator.clipboard.writeText(script).then(
              () => toast.success('Userscript copied'),
              () => toast.error('Could not copy. Download it instead.'),
            )
          }
        >
          Copy userscript
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Make a new token? The installed script stops working until you install the new one.')) return;
            run(makeOdysseyToken, 'New token made. Download the script again.');
          }}
        >
          Make a new token
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Turn off the userscript? Runway refuses its rows until you turn it on again.')) return;
            run(turnOffOdysseyScript, 'Userscript turned off');
          }}
        >
          Turn off userscript
        </Button>
      </div>
    </div>
  );
}
