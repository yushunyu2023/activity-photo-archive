// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ActivityPhotoRegistry
 * @notice Immutable activity-photo index and mutable activity permission registry.
 * @dev Photos and metadata live off-chain. This contract only stores public account
 * encryption parameters and content-addressed references.
 */
contract ActivityPhotoRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    uint8 public constant ASSET_TYPE_PHOTO = 1;
    uint16 public constant SCHEMA_VERSION = 1;
    uint32 public constant INITIAL_KEY_EPOCH = 1;
    uint64 public constant MAX_CAPTURE_FUTURE_SKEW = 1 days;
    uint256 public constant MAX_ACTIVITY_NAME_CHARACTERS = 20;
    uint256 public constant MAX_ACTIVITY_MEMBERS = 20;
    uint8 public constant ACCOUNT_KDF_VERSION = 1;
    uint8 public constant ACCOUNT_ENCRYPTION_SCHEMA_VERSION = 1;

    struct Activity {
        address owner;
        string name;
        uint64 createdAt;
        uint32 keyEpoch;
        bytes32 keyManifestTxId;
        bytes32 keyManifestHash;
        bool exists;
    }

    struct Photo {
        uint256 activityId;
        uint8 assetType;
        uint16 schemaVersion;
        bytes32 photoTxId;
        bytes32 metadataTxId;
        bytes32 contentHash;
        bytes32 metadataHash;
        uint64 capturedAt;
        uint64 publishedAt;
        address publisher;
        uint32 keyEpoch;
    }

    struct AccountEncryption {
        bytes32 publicKey;
        bytes16 kdfSalt;
        uint8 kdfVersion;
        uint8 schemaVersion;
        bool exists;
    }

    uint256 public activityCount;

    mapping(uint256 activityId => Activity activity) private _activities;
    mapping(address owner => uint256 activityId) private _ownedActivityId;
    mapping(uint256 activityId => EnumerableSet.AddressSet uploaders) private _uploaders;
    mapping(uint256 activityId => EnumerableSet.AddressSet viewers) private _viewers;
    mapping(uint256 activityId => mapping(address account => bool removed)) private _removedMembers;
    mapping(bytes32 assetId => Photo photo) private _photos;
    mapping(bytes32 assetId => bool exists) private _assetExists;
    mapping(address account => AccountEncryption encryption) private _accountEncryptions;

    event ActivityCreated(uint256 indexed activityId, address indexed owner, string name, uint64 createdAt);
    event UploaderAdded(uint256 indexed activityId, address indexed account, address indexed operator);
    event UploaderRemoved(uint256 indexed activityId, address indexed account, address indexed operator);
    event ViewerAdded(uint256 indexed activityId, address indexed account, address indexed operator);
    event ViewerRemoved(uint256 indexed activityId, address indexed account, address indexed operator);
    event ViewerPromotedToUploader(uint256 indexed activityId, address indexed account, address indexed operator);
    event AccountEncryptionRegistered(
        address indexed account, bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion
    );
    event KeyManifestUpdated(
        uint256 indexed activityId,
        uint32 indexed keyEpoch,
        bytes32 keyManifestTxId,
        bytes32 keyManifestHash,
        address indexed operator
    );
    event PhotoPublished(
        bytes32 indexed assetId,
        uint256 indexed activityId,
        bytes32 photoTxId,
        bytes32 metadataTxId,
        bytes32 contentHash,
        bytes32 metadataHash,
        uint64 capturedAt,
        uint32 keyEpoch,
        address indexed publisher
    );
    error ActivityNotFound(uint256 activityId);
    error ActivityAlreadyOwned(address owner, uint256 existingActivityId);
    error NotActivityOwner(uint256 activityId, address account);
    error NotActivityOperator(uint256 activityId, address account);
    error InvalidAddress();
    error InvalidActivityName();
    error OwnerCannotBeMember(uint256 activityId, address owner);
    error AlreadyAssigned(uint256 activityId, address account);
    error NotAssigned(uint256 activityId, address account);
    error MemberLimitReached(uint256 activityId, uint256 maximum);
    error MemberAlreadyRemoved(uint256 activityId, address account);
    error OnlyViewerCanBePromoted(uint256 activityId, address account);
    error InvalidPublicKey();
    error InvalidKdfSalt();
    error InvalidKdfVersion(uint8 version);
    error InvalidEncryptionSchemaVersion(uint8 version);
    error AccountEncryptionAlreadyRegistered(address account);
    error InvalidStorageReference();
    error InvalidContentHash();
    error InvalidMetadataHash();
    error InvalidCapturedAt(uint64 capturedAt);
    error AssetAlreadyExists(bytes32 assetId);
    error InvalidKeyEpoch(uint32 currentEpoch, uint32 requestedEpoch);

    /**
     * @notice Create an activity owned permanently by the caller. Each address can own at most one activity.
     */
    function createActivity(string calldata name) external returns (uint256 activityId) {
        uint256 existingActivityId = _ownedActivityId[msg.sender];
        if (existingActivityId != 0) revert ActivityAlreadyOwned(msg.sender, existingActivityId);
        _validateActivityName(name);

        activityId = ++activityCount;
        _ownedActivityId[msg.sender] = activityId;

        _activities[activityId] = Activity({
            owner: msg.sender,
            name: name,
            createdAt: uint64(block.timestamp),
            keyEpoch: INITIAL_KEY_EPOCH,
            keyManifestTxId: bytes32(0),
            keyManifestHash: bytes32(0),
            exists: true
        });

        emit ActivityCreated(activityId, msg.sender, name, uint64(block.timestamp));
    }

    function addUploader(uint256 activityId, address account) external {
        _requireOwner(activityId, msg.sender);
        _validateNewMember(activityId, account);
        _uploaders[activityId].add(account);

        emit UploaderAdded(activityId, account, msg.sender);
    }

    function removeUploader(uint256 activityId, address account) external {
        _requireOwner(activityId, msg.sender);
        if (!_uploaders[activityId].remove(account)) revert NotAssigned(activityId, account);
        _removedMembers[activityId][account] = true;

        emit UploaderRemoved(activityId, account, msg.sender);
    }

    function addViewer(uint256 activityId, address account) external {
        _requireOwner(activityId, msg.sender);
        _validateNewMember(activityId, account);
        _viewers[activityId].add(account);

        emit ViewerAdded(activityId, account, msg.sender);
    }

    function removeViewer(uint256 activityId, address account) external {
        _requireOwner(activityId, msg.sender);
        if (!_viewers[activityId].remove(account)) revert NotAssigned(activityId, account);
        _removedMembers[activityId][account] = true;

        emit ViewerRemoved(activityId, account, msg.sender);
    }

    function promoteViewerToUploader(uint256 activityId, address account) external {
        _requireOwner(activityId, msg.sender);
        if (_removedMembers[activityId][account]) revert MemberAlreadyRemoved(activityId, account);
        if (!_viewers[activityId].remove(account)) revert OnlyViewerCanBePromoted(activityId, account);
        if (account == address(0) || account == msg.sender) revert OwnerCannotBeMember(activityId, account);
        if (!_uploaders[activityId].add(account)) revert AlreadyAssigned(activityId, account);

        emit ViewerPromotedToUploader(activityId, account, msg.sender);
    }

    /**
     * @notice Register the caller's deterministic account-encryption public parameters.
     * @dev The caller cannot replace the encryption identity after the first registration.
     */
    function registerAccountEncryption(bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion)
        external
    {
        if (publicKey == bytes32(0)) revert InvalidPublicKey();
        if (kdfSalt == bytes16(0)) revert InvalidKdfSalt();
        if (kdfVersion != ACCOUNT_KDF_VERSION) revert InvalidKdfVersion(kdfVersion);
        if (schemaVersion != ACCOUNT_ENCRYPTION_SCHEMA_VERSION) {
            revert InvalidEncryptionSchemaVersion(schemaVersion);
        }
        if (_accountEncryptions[msg.sender].exists) {
            revert AccountEncryptionAlreadyRegistered(msg.sender);
        }

        _accountEncryptions[msg.sender] = AccountEncryption({
            publicKey: publicKey, kdfSalt: kdfSalt, kdfVersion: kdfVersion, schemaVersion: schemaVersion, exists: true
        });
        emit AccountEncryptionRegistered(msg.sender, publicKey, kdfSalt, kdfVersion, schemaVersion);
    }

    /**
     * @notice Publish a new key manifest for the current epoch, or rotate to the next epoch.
     */
    function updateKeyManifest(uint256 activityId, uint32 newKeyEpoch, bytes32 keyManifestTxId, bytes32 keyManifestHash)
        external
    {
        _requireOwner(activityId, msg.sender);
        if (keyManifestTxId == bytes32(0) || keyManifestHash == bytes32(0)) {
            revert InvalidStorageReference();
        }

        Activity storage activity = _activities[activityId];
        uint32 currentEpoch = activity.keyEpoch;
        if (newKeyEpoch != currentEpoch && newKeyEpoch != currentEpoch + 1) {
            revert InvalidKeyEpoch(currentEpoch, newKeyEpoch);
        }

        activity.keyEpoch = newKeyEpoch;
        activity.keyManifestTxId = keyManifestTxId;
        activity.keyManifestHash = keyManifestHash;

        emit KeyManifestUpdated(activityId, newKeyEpoch, keyManifestTxId, keyManifestHash, msg.sender);
    }

    /**
     * @notice Append an immutable photo record. There is intentionally no update or delete function.
     */
    function publishPhoto(
        uint256 activityId,
        bytes32 photoTxId,
        bytes32 metadataTxId,
        bytes32 contentHash,
        bytes32 metadataHash,
        uint64 capturedAt,
        uint32 expectedKeyEpoch
    ) external returns (bytes32 assetId) {
        _requireActivity(activityId);
        Activity storage activity = _activities[activityId];
        if (msg.sender != activity.owner && !_uploaders[activityId].contains(msg.sender)) {
            revert NotActivityOperator(activityId, msg.sender);
        }

        if (photoTxId == bytes32(0) || metadataTxId == bytes32(0) || photoTxId == metadataTxId) {
            revert InvalidStorageReference();
        }
        if (contentHash == bytes32(0)) revert InvalidContentHash();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (capturedAt == 0 || capturedAt > block.timestamp + MAX_CAPTURE_FUTURE_SKEW) {
            revert InvalidCapturedAt(capturedAt);
        }
        if (expectedKeyEpoch != activity.keyEpoch) {
            revert InvalidKeyEpoch(activity.keyEpoch, expectedKeyEpoch);
        }

        assetId = computeAssetId(activityId, contentHash);
        if (_assetExists[assetId]) revert AssetAlreadyExists(assetId);

        _assetExists[assetId] = true;
        _photos[assetId] = Photo({
            activityId: activityId,
            assetType: ASSET_TYPE_PHOTO,
            schemaVersion: SCHEMA_VERSION,
            photoTxId: photoTxId,
            metadataTxId: metadataTxId,
            contentHash: contentHash,
            metadataHash: metadataHash,
            capturedAt: capturedAt,
            publishedAt: uint64(block.timestamp),
            publisher: msg.sender,
            keyEpoch: expectedKeyEpoch
        });

        emit PhotoPublished(
            assetId,
            activityId,
            photoTxId,
            metadataTxId,
            contentHash,
            metadataHash,
            capturedAt,
            expectedKeyEpoch,
            msg.sender
        );
    }

    function computeAssetId(uint256 activityId, bytes32 contentHash) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), activityId, contentHash));
    }

    function getActivity(uint256 activityId) external view returns (Activity memory) {
        _requireActivity(activityId);
        return _activities[activityId];
    }

    function getActivityIdByOwner(address owner) external view returns (uint256) {
        return _ownedActivityId[owner];
    }

    function getPhoto(bytes32 assetId) external view returns (Photo memory) {
        if (!_assetExists[assetId]) revert InvalidStorageReference();
        return _photos[assetId];
    }

    function isUploader(uint256 activityId, address account) public view returns (bool) {
        return _uploaders[activityId].contains(account);
    }

    function isViewer(uint256 activityId, address account) public view returns (bool) {
        return _viewers[activityId].contains(account);
    }

    function canPublish(uint256 activityId, address account) public view returns (bool) {
        if (!_activities[activityId].exists) return false;
        return account == _activities[activityId].owner || _uploaders[activityId].contains(account);
    }

    function canView(uint256 activityId, address account) public view returns (bool) {
        if (!_activities[activityId].exists) return false;
        return account == _activities[activityId].owner || _uploaders[activityId].contains(account)
            || _viewers[activityId].contains(account);
    }

    function getUploaders(uint256 activityId) external view returns (address[] memory) {
        _requireActivity(activityId);
        return _uploaders[activityId].values();
    }

    function getViewers(uint256 activityId) external view returns (address[] memory) {
        _requireActivity(activityId);
        return _viewers[activityId].values();
    }

    function getCurrentMemberCount(uint256 activityId) external view returns (uint256) {
        _requireActivity(activityId);
        return 1 + _uploaders[activityId].length() + _viewers[activityId].length();
    }

    function isRemovedMember(uint256 activityId, address account) external view returns (bool) {
        return _removedMembers[activityId][account];
    }

    function getAccountEncryption(address account) external view returns (AccountEncryption memory) {
        return _accountEncryptions[account];
    }

    function _requireActivity(uint256 activityId) private view {
        if (!_activities[activityId].exists) revert ActivityNotFound(activityId);
    }

    function _requireOwner(uint256 activityId, address account) private view {
        _requireActivity(activityId);
        if (_activities[activityId].owner != account) revert NotActivityOwner(activityId, account);
    }

    function _validateNewMember(uint256 activityId, address account) private view {
        if (account == address(0)) revert InvalidAddress();
        if (account == _activities[activityId].owner) revert OwnerCannotBeMember(activityId, account);
        if (_removedMembers[activityId][account]) revert MemberAlreadyRemoved(activityId, account);
        if (_uploaders[activityId].contains(account) || _viewers[activityId].contains(account)) {
            revert AlreadyAssigned(activityId, account);
        }
        if (1 + _uploaders[activityId].length() + _viewers[activityId].length() >= MAX_ACTIVITY_MEMBERS) {
            revert MemberLimitReached(activityId, MAX_ACTIVITY_MEMBERS);
        }
    }

    function _validateActivityName(string memory name) private pure {
        bytes memory characters = bytes(name);
        uint256 byteLength = characters.length;
        if (byteLength == 0) revert InvalidActivityName();
        if (characters[0] == 0x20 || characters[byteLength - 1] == 0x20) revert InvalidActivityName();

        uint256 characterCount = 0;
        uint256 index = 0;
        while (index < byteLength) {
            uint8 first = uint8(characters[index]);
            if (first < 0x20 || first == 0x7F) revert InvalidActivityName();

            if (first < 0x80) {
                index += 1;
            } else if (first >= 0xC2 && first <= 0xDF) {
                if (index + 1 >= byteLength) revert InvalidActivityName();
                uint8 second = uint8(characters[index + 1]);
                if (second < 0x80 || second > 0xBF) revert InvalidActivityName();
                if (first == 0xC2 && second < 0xA0) revert InvalidActivityName();
                index += 2;
            } else if (first >= 0xE0 && first <= 0xEF) {
                if (index + 2 >= byteLength) revert InvalidActivityName();
                uint8 second = uint8(characters[index + 1]);
                uint8 third = uint8(characters[index + 2]);
                if (second < 0x80 || second > 0xBF || third < 0x80 || third > 0xBF) {
                    revert InvalidActivityName();
                }
                if (first == 0xE0 && second < 0xA0) revert InvalidActivityName();
                if (first == 0xED && second > 0x9F) revert InvalidActivityName();
                index += 3;
            } else if (first >= 0xF0 && first <= 0xF4) {
                if (index + 3 >= byteLength) revert InvalidActivityName();
                uint8 second = uint8(characters[index + 1]);
                uint8 third = uint8(characters[index + 2]);
                uint8 fourth = uint8(characters[index + 3]);
                if (second < 0x80 || second > 0xBF || third < 0x80 || third > 0xBF || fourth < 0x80 || fourth > 0xBF) {
                    revert InvalidActivityName();
                }
                if (first == 0xF0 && second < 0x90) revert InvalidActivityName();
                if (first == 0xF4 && second > 0x8F) revert InvalidActivityName();
                index += 4;
            } else {
                revert InvalidActivityName();
            }

            characterCount += 1;
            if (characterCount > MAX_ACTIVITY_NAME_CHARACTERS) revert InvalidActivityName();
        }
    }
}
