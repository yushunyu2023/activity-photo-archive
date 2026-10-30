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
    uint16 public constant TIME_CAPSULE_SCHEMA_VERSION = 1;
    uint64 public constant MAX_TIME_CAPSULE_DURATION = 30 days;
    bytes32 public constant QUICKNET_CHAIN_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
    bytes32 public constant QUICKNET_PUBLIC_KEY_HASH = keccak256(
        hex"83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a"
    );
    bytes32 public constant QUICKNET_SCHEME_ID_HASH = keccak256("bls-unchained-g1-rfc9380");
    uint32 public constant QUICKNET_PERIOD = 3;
    uint64 public constant QUICKNET_GENESIS_TIME = 1_692_803_367;

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
        bool isTimeCapsule;
    }

    struct TimeCapsule {
        uint16 schemaVersion;
        uint64 unlockAt;
        uint32 targetRound;
        uint32 period;
        uint64 genesisTime;
        bytes32 chainHash;
        bytes publicKey;
        string schemeID;
        bytes32 tlockCiphertextTxId;
        bytes32 tlockCiphertextHash;
        bool exists;
    }

    struct PhotoInput {
        bytes32 photoTxId;
        bytes32 metadataTxId;
        bytes32 contentHash;
        bytes32 metadataHash;
        uint64 capturedAt;
    }

    struct TimeCapsuleInput {
        uint64 unlockAt;
        uint32 targetRound;
        uint32 period;
        uint64 genesisTime;
        bytes32 chainHash;
        bytes publicKey;
        string schemeID;
        bytes32 tlockCiphertextTxId;
        bytes32 tlockCiphertextHash;
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
    mapping(bytes32 assetId => TimeCapsule capsule) private _timeCapsules;
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
    event TimeCapsulePublished(
        bytes32 indexed assetId,
        uint256 indexed activityId,
        bytes32 indexed tlockCiphertextTxId,
        bytes32 tlockCiphertextHash,
        bytes32 chainHash,
        uint64 genesisTime,
        uint32 period,
        uint64 unlockAt,
        uint32 targetRound,
        address publisher
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
    error InvalidTimeCapsuleUnlockAt(uint64 unlockAt);
    error InvalidTimeCapsuleProtocol();
    error InvalidTimeCapsuleRound(uint32 expectedRound, uint32 actualRound);
    error InvalidTimeCapsuleReference();
    error TimeCapsuleNotFound(bytes32 assetId);

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
        return _publishPhoto(
            activityId,
            PhotoInput({
                photoTxId: photoTxId,
                metadataTxId: metadataTxId,
                contentHash: contentHash,
                metadataHash: metadataHash,
                capturedAt: capturedAt
            }),
            expectedKeyEpoch,
            false
        );
    }

    /**
     * @notice Publish an immutable photo whose independently random capsule secret is time-locked.
     * @dev Only the activity owner may create a time capsule. The photo itself still follows the
     * normal activity permission model after the target beacon becomes available.
     */
    function publishTimeCapsule(
        uint256 activityId,
        bytes32 photoTxId,
        bytes32 metadataTxId,
        bytes32 contentHash,
        bytes32 metadataHash,
        uint64 capturedAt,
        uint32 expectedKeyEpoch,
        TimeCapsuleInput calldata capsule
    ) external returns (bytes32 assetId) {
        _requireOwner(activityId, msg.sender);
        _validateTimeCapsule(capsule, photoTxId, metadataTxId);

        assetId = _publishPhoto(
            activityId,
            PhotoInput({
                photoTxId: photoTxId,
                metadataTxId: metadataTxId,
                contentHash: contentHash,
                metadataHash: metadataHash,
                capturedAt: capturedAt
            }),
            expectedKeyEpoch,
            true
        );

        _timeCapsules[assetId] = TimeCapsule({
            schemaVersion: TIME_CAPSULE_SCHEMA_VERSION,
            unlockAt: capsule.unlockAt,
            targetRound: capsule.targetRound,
            period: capsule.period,
            genesisTime: capsule.genesisTime,
            chainHash: capsule.chainHash,
            publicKey: capsule.publicKey,
            schemeID: capsule.schemeID,
            tlockCiphertextTxId: capsule.tlockCiphertextTxId,
            tlockCiphertextHash: capsule.tlockCiphertextHash,
            exists: true
        });

        emit TimeCapsulePublished(
            assetId,
            activityId,
            capsule.tlockCiphertextTxId,
            capsule.tlockCiphertextHash,
            capsule.chainHash,
            capsule.genesisTime,
            capsule.period,
            capsule.unlockAt,
            capsule.targetRound,
            msg.sender
        );
    }

    function _publishPhoto(uint256 activityId, PhotoInput memory input, uint32 expectedKeyEpoch, bool isTimeCapsule)
        private
        returns (bytes32 assetId)
    {
        _requireActivity(activityId);
        Activity storage activity = _activities[activityId];
        if (msg.sender != activity.owner && !_uploaders[activityId].contains(msg.sender)) {
            revert NotActivityOperator(activityId, msg.sender);
        }

        if (input.photoTxId == bytes32(0) || input.metadataTxId == bytes32(0) || input.photoTxId == input.metadataTxId)
        {
            revert InvalidStorageReference();
        }
        if (input.contentHash == bytes32(0)) revert InvalidContentHash();
        if (input.metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (input.capturedAt == 0 || input.capturedAt > block.timestamp + MAX_CAPTURE_FUTURE_SKEW) {
            revert InvalidCapturedAt(input.capturedAt);
        }
        if (expectedKeyEpoch != activity.keyEpoch) {
            revert InvalidKeyEpoch(activity.keyEpoch, expectedKeyEpoch);
        }

        assetId = computeAssetId(activityId, input.contentHash);
        if (_assetExists[assetId]) revert AssetAlreadyExists(assetId);

        _assetExists[assetId] = true;
        _photos[assetId] = Photo({
            activityId: activityId,
            assetType: ASSET_TYPE_PHOTO,
            schemaVersion: SCHEMA_VERSION,
            photoTxId: input.photoTxId,
            metadataTxId: input.metadataTxId,
            contentHash: input.contentHash,
            metadataHash: input.metadataHash,
            capturedAt: input.capturedAt,
            publishedAt: uint64(block.timestamp),
            publisher: msg.sender,
            keyEpoch: expectedKeyEpoch,
            isTimeCapsule: isTimeCapsule
        });

        emit PhotoPublished(
            assetId,
            activityId,
            input.photoTxId,
            input.metadataTxId,
            input.contentHash,
            input.metadataHash,
            input.capturedAt,
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

    function getTimeCapsule(bytes32 assetId) external view returns (TimeCapsule memory) {
        if (!_assetExists[assetId] || !_photos[assetId].isTimeCapsule) {
            revert TimeCapsuleNotFound(assetId);
        }
        return _timeCapsules[assetId];
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

    function _validateTimeCapsule(TimeCapsuleInput calldata capsule, bytes32 photoTxId, bytes32 metadataTxId)
        private
        view
    {
        if (
            capsule.unlockAt <= block.timestamp || capsule.unlockAt % 60 != 0
                || capsule.unlockAt > block.timestamp + MAX_TIME_CAPSULE_DURATION
        ) {
            revert InvalidTimeCapsuleUnlockAt(capsule.unlockAt);
        }
        if (
            capsule.chainHash != QUICKNET_CHAIN_HASH || capsule.period != QUICKNET_PERIOD
                || capsule.genesisTime != QUICKNET_GENESIS_TIME || capsule.unlockAt <= capsule.genesisTime
                || keccak256(capsule.publicKey) != QUICKNET_PUBLIC_KEY_HASH
                || keccak256(bytes(capsule.schemeID)) != QUICKNET_SCHEME_ID_HASH
        ) {
            revert InvalidTimeCapsuleProtocol();
        }
        if (
            capsule.tlockCiphertextTxId == bytes32(0) || capsule.tlockCiphertextHash == bytes32(0)
                || capsule.tlockCiphertextTxId == photoTxId || capsule.tlockCiphertextTxId == metadataTxId
                || capsule.tlockCiphertextTxId == capsule.tlockCiphertextHash
        ) {
            revert InvalidTimeCapsuleReference();
        }

        uint256 elapsed = uint256(capsule.unlockAt) - uint256(capsule.genesisTime);
        uint256 expectedRound = (elapsed + uint256(capsule.period) - 1) / uint256(capsule.period) + 1;
        if (expectedRound > type(uint32).max || capsule.targetRound != uint32(expectedRound)) {
            revert InvalidTimeCapsuleRound(uint32(expectedRound), capsule.targetRound);
        }
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
