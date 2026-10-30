import { isHex } from "viem";
import { notFound } from "next/navigation";
import { AssetPage } from "@/components/asset-page";

export default async function PhotoAssetPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  if (!isHex(assetId) || assetId.length !== 66) notFound();
  return <AssetPage assetId={assetId} />;
}
