import { BottomBar, Rail, TopBar } from '@/components/app/nav';
import { ShellProvider } from '@/components/app/shell-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getAppContext, toLite } from '@/lib/db/queries';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const { supabase, courses } = await getAppContext();
  const { count } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'pending');

  return (
    <ShellProvider courses={courses.map(toLite)}>
      <TooltipProvider delay={300}>
        <div className="flex min-h-dvh">
          <Rail inboxCount={count ?? 0} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="w-full max-w-280 flex-1 px-4 pt-4 pb-24 sm:px-6 sm:pb-10">{children}</main>
          </div>
        </div>
        <BottomBar />
      </TooltipProvider>
    </ShellProvider>
  );
}
