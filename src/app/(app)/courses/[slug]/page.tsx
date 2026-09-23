import { redirect } from 'next/navigation';

export default async function CourseIndex({ params }: PageProps<'/courses/[slug]'>) {
  const { slug } = await params;
  redirect(`/courses/${slug}/overview`);
}
