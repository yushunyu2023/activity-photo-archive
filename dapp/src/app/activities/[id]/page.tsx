import { notFound } from "next/navigation";
import { ActivityPage } from "@/components/activity-page";
import { isValidActivityId } from "@/lib/activity-id";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidActivityId(id)) notFound();
  return <ActivityPage activityId={id} />;
}
