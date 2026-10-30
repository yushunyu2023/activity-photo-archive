import { notFound } from "next/navigation";
import { UploadPage } from "@/components/upload-page";
import { isValidActivityId } from "@/lib/activity-id";

export default async function ActivityUploadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidActivityId(id)) notFound();
  return <UploadPage activityId={id} />;
}
