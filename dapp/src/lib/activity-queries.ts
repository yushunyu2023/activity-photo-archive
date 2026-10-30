import type { Address, PublicClient } from "viem";
import {
  DEPLOY_BLOCK,
  ACTIVITY_PHOTO_REGISTRY_ABI,
  requireRegistryAddress,
} from "@/lib/contract";
import { decodeContractError } from "@/lib/transaction-errors";
import type {
  ActivityMembership,
  ActivityRecord,
  PhotoRecord,
} from "@/lib/types";

type ActivityReadResult = {
  owner: Address;
  name: string;
  createdAt: bigint;
  keyEpoch: number;
  keyManifestTxId: `0x${string}`;
  keyManifestHash: `0x${string}`;
  exists: boolean;
};

const configuredLogBlockRange = BigInt(
  process.env.NEXT_PUBLIC_LOG_BLOCK_RANGE ?? "9000",
);
const LOG_BLOCK_RANGE =
  configuredLogBlockRange > 0n ? configuredLogBlockRange : 9000n;

async function getActivityCreatedLogs(
  publicClient: PublicClient,
  contractAddress: Address,
) {
  const latestBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
  const logs = [];

  for (
    let fromBlock = DEPLOY_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += LOG_BLOCK_RANGE
  ) {
    const toBlock = fromBlock + LOG_BLOCK_RANGE - 1n;
    logs.push(
      ...(await publicClient.getContractEvents({
        address: contractAddress,
        abi: ACTIVITY_PHOTO_REGISTRY_ABI,
        eventName: "ActivityCreated",
        fromBlock,
        toBlock: toBlock > latestBlock ? latestBlock : toBlock,
      })),
    );
  }

  return logs;
}

async function getPhotoPublishedLogs(
  publicClient: PublicClient,
  contractAddress: Address,
  activityId: bigint,
) {
  const latestBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
  const logs = [];

  for (
    let fromBlock = DEPLOY_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += LOG_BLOCK_RANGE
  ) {
    const toBlock = fromBlock + LOG_BLOCK_RANGE - 1n;
    logs.push(
      ...(await publicClient.getContractEvents({
        address: contractAddress,
        abi: ACTIVITY_PHOTO_REGISTRY_ABI,
        eventName: "PhotoPublished",
        args: { activityId },
        fromBlock,
        toBlock: toBlock > latestBlock ? latestBlock : toBlock,
      })),
    );
  }

  return logs;
}

export async function listRemovedActivityMembers(
  publicClient: PublicClient,
  activityId: bigint,
): Promise<Address[]> {
  const contractAddress = requireRegistryAddress();
  const latestBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
  const removed = new Set<string>();

  for (
    let fromBlock = DEPLOY_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += LOG_BLOCK_RANGE
  ) {
    const toBlock = fromBlock + LOG_BLOCK_RANGE - 1n;
    const boundedToBlock = toBlock > latestBlock ? latestBlock : toBlock;
    const [uploaderRemoved, viewerRemoved] = await Promise.all([
      publicClient.getContractEvents({
        address: contractAddress,
        abi: ACTIVITY_PHOTO_REGISTRY_ABI,
        eventName: "UploaderRemoved",
        args: { activityId },
        fromBlock,
        toBlock: boundedToBlock,
      }),
      publicClient.getContractEvents({
        address: contractAddress,
        abi: ACTIVITY_PHOTO_REGISTRY_ABI,
        eventName: "ViewerRemoved",
        args: { activityId },
        fromBlock,
        toBlock: boundedToBlock,
      }),
    ]);

    for (const log of [...uploaderRemoved, ...viewerRemoved]) {
      const account = log.args.account;
      if (account) removed.add(account.toLowerCase());
    }
  }

  return [...removed].map((account) => account as Address);
}

export async function readActivity(
  publicClient: PublicClient,
  activityId: bigint,
): Promise<ActivityRecord> {
  const result = (await publicClient.readContract({
    address: requireRegistryAddress(),
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getActivity",
    args: [activityId],
  })) as ActivityReadResult;

  return {
    ...result,
    keyEpoch: Number(result.keyEpoch),
  };
}

export async function listActivitiesForAccount(
  publicClient: PublicClient,
  account: Address,
): Promise<ActivityMembership[]> {
  const address = requireRegistryAddress();
  const logs = await getActivityCreatedLogs(publicClient, address);
  const activityIds = [...new Set(logs.map((log) => log.args.activityId).filter(Boolean))];

  const memberships = await Promise.all(
    activityIds.map(async (activityId) => {
      if (activityId === undefined) return null;
      const [activity, canPublish, canView] = await Promise.all([
        readActivity(publicClient, activityId),
        publicClient.readContract({
          address,
          abi: ACTIVITY_PHOTO_REGISTRY_ABI,
          functionName: "canPublish",
          args: [activityId, account],
        }),
        publicClient.readContract({
          address,
          abi: ACTIVITY_PHOTO_REGISTRY_ABI,
          functionName: "canView",
          args: [activityId, account],
        }),
      ]);

      if (!canPublish && !canView) return null;
      return {
        activityId,
        activity,
        canPublish: Boolean(canPublish),
        canView: Boolean(canView),
      } satisfies ActivityMembership;
    }),
  );

  return memberships
    .filter((membership): membership is ActivityMembership => membership !== null)
    .sort((left, right) => Number(right.activityId - left.activityId));
}

export async function listActivityPhotos(
  publicClient: PublicClient,
  activityId: bigint,
): Promise<Array<{ assetId: `0x${string}`; photo: PhotoRecord }>> {
  const address = requireRegistryAddress();
  const logs = await getPhotoPublishedLogs(publicClient, address, activityId);

  const photos = await Promise.all(
    logs
      .filter((log) => log.args.assetId)
      .map(async (log) => {
        const assetId = log.args.assetId as `0x${string}`;
        const result = (await publicClient.readContract({
          address,
          abi: ACTIVITY_PHOTO_REGISTRY_ABI,
          functionName: "getPhoto",
          args: [assetId],
        })) as PhotoRecord;

        return {
          assetId,
          photo: {
            ...result,
            keyEpoch: Number(result.keyEpoch),
          },
        };
      }),
  );

  return photos.sort(
    (left, right) => Number(right.photo.capturedAt - left.photo.capturedAt),
  );
}

export async function readPhoto(
  publicClient: PublicClient,
  assetId: `0x${string}`,
): Promise<PhotoRecord> {
  const result = (await publicClient.readContract({
    address: requireRegistryAddress(),
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "getPhoto",
    args: [assetId],
  })) as PhotoRecord;

  return {
    ...result,
    keyEpoch: Number(result.keyEpoch),
  };
}

export async function findPhotoByContentHash(
  publicClient: PublicClient,
  activityId: bigint,
  contentHash: `0x${string}`,
): Promise<{ assetId: `0x${string}`; photo: PhotoRecord } | null> {
  const assetId = (await publicClient.readContract({
    address: requireRegistryAddress(),
    abi: ACTIVITY_PHOTO_REGISTRY_ABI,
    functionName: "computeAssetId",
    args: [activityId, contentHash],
  })) as `0x${string}`;

  try {
    return {
      assetId,
      photo: await readPhoto(publicClient, assetId),
    };
  } catch (error) {
    const decoded = decodeContractError(error, ACTIVITY_PHOTO_REGISTRY_ABI);
    if (decoded?.errorName === "InvalidStorageReference") return null;
    throw error;
  }
}
