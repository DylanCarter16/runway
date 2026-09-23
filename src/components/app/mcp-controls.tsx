'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { makeMcpLink, turnOffMcp } from '@/app/(app)/settings/actions';

/** Settings, Integrations: the read-only MCP connector for Claude chats. */
export function McpControls({ url }: { url: string | null }) {
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

  if (!url) {
    return (
      <div>
        <Button className="h-11 sm:h-9" disabled={isPending} onClick={() => run(makeMcpLink, 'Connector link made')}>
          {isPending ? 'Making link' : 'Make connector link'}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <label htmlFor="mcp-url" className="text-sm font-semibold">
        Connector link
      </label>
      <Input
        id="mcp-url"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        aria-describedby="mcp-url-help"
        className="h-11 font-mono text-xs sm:h-9"
      />
      <p id="mcp-url-help" className="text-sm text-muted-foreground">
        Anyone with this link can read your deadlines and the notes from courses with AI on, so keep it private. If it leaks, make a new link; the old one
        stops working.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11 sm:h-8"
          onClick={() =>
            navigator.clipboard.writeText(url).then(
              () => toast.success('Link copied'),
              () => toast.error('Could not copy. Select the link and copy it by hand.'),
            )
          }
        >
          Copy link
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Make a new connector link? Claude stops reaching Runway until you add the new link.')) return;
            run(makeMcpLink, 'New link made. Update the connector in Claude with it.');
          }}
        >
          Make a new link
        </Button>
        <Button
          variant="ghost"
          className="h-11 sm:h-8"
          disabled={isPending}
          onClick={() => {
            if (!window.confirm('Turn off the connector? Claude chats can no longer read Runway.')) return;
            run(turnOffMcp, 'Connector turned off');
          }}
        >
          Turn off connector
        </Button>
      </div>
    </div>
  );
}
