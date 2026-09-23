import { notFound } from 'next/navigation';
import { ItemDetailView } from '@/components/app/item-detail';
import { getItemDetail } from '@/app/(app)/actions';

export const metadata = { title: 'Item' };

export default async function ItemPage({ params }: PageProps<'/items/[id]'>) {
  const { id } = await params;
  const result = await getItemDetail(id);
  if (!result.ok) notFound();
  return (
    <div className="max-w-2xl">
      <ItemDetailView detail={result.data} key={JSON.stringify(result.data.item)} />
    </div>
  );
}
