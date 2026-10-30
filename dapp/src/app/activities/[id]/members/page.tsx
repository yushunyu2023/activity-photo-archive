import { notFound } from "next/navigation";
import { MembersPage } from "@/components/members-page";
import { isValidActivityId } from "@/lib/activity-id";

export default async function ActivityMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidActivityId(id)) notFound();
  return <MembersPage activityId={id} />;
}
