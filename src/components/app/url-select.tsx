'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { selectClass } from '@/lib/ui';
import { cn } from '@/lib/utils';

/** A select whose value lives in one URL search param. */
export function UrlSelect({
  param,
  label,
  options,
  allLabel,
  className,
}: {
  param: string;
  label: string;
  options: [string, string][];
  allLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className={cn('grid gap-1 text-sm', className)}>
      <span className="font-semibold">{label}</span>
      <select
        className={selectClass}
        value={params.get(param) ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set(param, e.target.value);
          else next.delete(param);
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        }}
      >
        <option value="">{allLabel}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
