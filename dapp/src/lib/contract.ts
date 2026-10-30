import {
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { parseAbi } from "viem";

export const ACTIVITY_PHOTO_REGISTRY_ABI = parseAbi([
  "event ActivityCreated(uint256 indexed activityId, address indexed owner, string name, uint64 createdAt)",
  "event UploaderAdded(uint256 indexed activityId, address indexed account, address indexed operator)",
  "event UploaderRemoved(uint256 indexed activityId, address indexed account, address indexed operator)",
  "event ViewerAdded(uint256 indexed activityId, address indexed account, address indexed operator)",
  "event ViewerRemoved(uint256 indexed activityId, address indexed account, address indexed operator)",
  "event ViewerPromotedToUploader(uint256 indexed activityId, address indexed account, address indexed operator)",
  "event AccountEncryptionRegistered(address indexed account, bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion)",
  "event KeyManifestUpdated(uint256 indexed activityId, uint32 indexed keyEpoch, bytes32 keyManifestTxId, bytes32 keyManifestHash, address indexed operator)",
  "event PhotoPublished(bytes32 indexed assetId, uint256 indexed activityId, bytes32 photoTxId, bytes32 metadataTxId, bytes32 contentHash, bytes32 metadataHash, uint64 capturedAt, uint32 keyEpoch, address indexed publisher)",
  "event TimeCapsulePublished(bytes32 indexed assetId, uint256 indexed activityId, bytes32 indexed tlockCiphertextTxId, bytes32 tlockCiphertextHash, bytes32 chainHash, uint64 genesisTime, uint32 period, uint64 unlockAt, uint32 targetRound, address publisher)",
  "function createActivity(string name) returns (uint256 activityId)",
  "function addUploader(uint256 activityId, address account)",
  "function removeUploader(uint256 activityId, address account)",
  "function addViewer(uint256 activityId, address account)",
  "function removeViewer(uint256 activityId, address account)",
  "function promoteViewerToUploader(uint256 activityId, address account)",
  "function registerAccountEncryption(bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion)",
  "function updateKeyManifest(uint256 activityId, uint32 newKeyEpoch, bytes32 keyManifestTxId, bytes32 keyManifestHash)",
  "function publishPhoto(uint256 activityId, bytes32 photoTxId, bytes32 metadataTxId, bytes32 contentHash, bytes32 metadataHash, uint64 capturedAt, uint32 expectedKeyEpoch) returns (bytes32 assetId)",
  "function publishTimeCapsule(uint256 activityId, bytes32 photoTxId, bytes32 metadataTxId, bytes32 contentHash, bytes32 metadataHash, uint64 capturedAt, uint32 expectedKeyEpoch, (uint64 unlockAt, uint32 targetRound, uint32 period, uint64 genesisTime, bytes32 chainHash, bytes publicKey, string schemeID, bytes32 tlockCiphertextTxId, bytes32 tlockCiphertextHash) capsule) returns (bytes32 assetId)",
  "function activityCount() view returns (uint256)",
  "function getActivityIdByOwner(address owner) view returns (uint256)",
  "function getActivity(uint256 activityId) view returns ((address owner, string name, uint64 createdAt, uint32 keyEpoch, bytes32 keyManifestTxId, bytes32 keyManifestHash, bool exists))",
  "function getPhoto(bytes32 assetId) view returns ((uint256 activityId, uint8 assetType, uint16 schemaVersion, bytes32 photoTxId, bytes32 metadataTxId, bytes32 contentHash, bytes32 metadataHash, uint64 capturedAt, uint64 publishedAt, address publisher, uint32 keyEpoch, bool isTimeCapsule))",
  "function getTimeCapsule(bytes32 assetId) view returns ((uint16 schemaVersion, uint64 unlockAt, uint32 targetRound, uint32 period, uint64 genesisTime, bytes32 chainHash, bytes publicKey, string schemeID, bytes32 tlockCiphertextTxId, bytes32 tlockCiphertextHash, bool exists))",
  "function isUploader(uint256 activityId, address account) view returns (bool)",
  "function isViewer(uint256 activityId, address account) view returns (bool)",
  "function canPublish(uint256 activityId, address account) view returns (bool)",
  "function canView(uint256 activityId, address account) view returns (bool)",
  "function getUploaders(uint256 activityId) view returns (address[])",
  "function getViewers(uint256 activityId) view returns (address[])",
  "function getCurrentMemberCount(uint256 activityId) view returns (uint256)",
  "function isRemovedMember(uint256 activityId, address account) view returns (bool)",
  "function getAccountEncryption(address account) view returns ((bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion, bool exists))",
  "function computeAssetId(uint256 activityId, bytes32 contentHash) view returns (bytes32)",
  "function INITIAL_KEY_EPOCH() view returns (uint32)",
  "function MAX_ACTIVITY_MEMBERS() view returns (uint256)",
  "function ACCOUNT_KDF_VERSION() view returns (uint8)",
  "function ACCOUNT_ENCRYPTION_SCHEMA_VERSION() view returns (uint8)",
  "function MAX_TIME_CAPSULE_DURATION() view returns (uint64)",
  "function QUICKNET_CHAIN_HASH() view returns (bytes32)",
  "error ActivityNotFound(uint256 activityId)",
  "error ActivityAlreadyOwned(address owner, uint256 existingActivityId)",
  "error NotActivityOwner(uint256 activityId, address account)",
  "error NotActivityOperator(uint256 activityId, address account)",
  "error InvalidAddress()",
  "error InvalidActivityName()",
  "error OwnerCannotBeMember(uint256 activityId, address owner)",
  "error AlreadyAssigned(uint256 activityId, address account)",
  "error NotAssigned(uint256 activityId, address account)",
  "error MemberLimitReached(uint256 activityId, uint256 maximum)",
  "error MemberAlreadyRemoved(uint256 activityId, address account)",
  "error OnlyViewerCanBePromoted(uint256 activityId, address account)",
  "error InvalidPublicKey()",
  "error InvalidKdfSalt()",
  "error InvalidKdfVersion(uint8 version)",
  "error InvalidEncryptionSchemaVersion(uint8 version)",
  "error AccountEncryptionAlreadyRegistered(address account)",
  "error InvalidStorageReference()",
  "error InvalidContentHash()",
  "error InvalidMetadataHash()",
  "error InvalidCapturedAt(uint64 capturedAt)",
  "error AssetAlreadyExists(bytes32 assetId)",
  "error InvalidKeyEpoch(uint32 currentEpoch, uint32 requestedEpoch)",
  "error InvalidTimeCapsuleUnlockAt(uint64 unlockAt)",
  "error InvalidTimeCapsuleProtocol()",
  "error InvalidTimeCapsuleRound(uint32 expectedRound, uint32 actualRound)",
  "error InvalidTimeCapsuleReference()",
  "error TimeCapsuleNotFound(bytes32 assetId)",
]);

const configuredAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

export const REGISTRY_ADDRESS: Address | undefined =
  configuredAddress &&
  isAddress(configuredAddress) &&
  configuredAddress !== "0x0000000000000000000000000000000000000000"
    ? configuredAddress
    : undefined;

export const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");

export function requireRegistryAddress(): Address {
  if (!REGISTRY_ADDRESS) {
    throw new Error("尚未配置 NEXT_PUBLIC_CONTRACT_ADDRESS");
  }
  return REGISTRY_ADDRESS;
}

export function asBytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("需要 32 字节十六进制值");
  }
  return value;
}
