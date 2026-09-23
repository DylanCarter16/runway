import { SettingsNav, ThemeToggle } from '@/components/app/settings-bits';

export default function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <ThemeToggle />
      </div>
      <SettingsNav />
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}
