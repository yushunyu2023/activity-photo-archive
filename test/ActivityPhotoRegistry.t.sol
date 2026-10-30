// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ActivityPhotoRegistry} from "../src/ActivityPhotoRegistry.sol";

contract ActivityPhotoRegistryTest is Test {
    ActivityPhotoRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal uploader = makeAddr("uploader");
    address internal viewer = makeAddr("viewer");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant PHOTO_TX = keccak256("photo");
    bytes32 internal constant METADATA_TX = keccak256("metadata");
    bytes32 internal constant CONTENT_HASH = keccak256("content");
    bytes32 internal constant METADATA_HASH = keccak256("metadata-hash");
    bytes32 internal constant TLOCK_TX = keccak256("tlock-ciphertext");
    bytes32 internal constant TLOCK_HASH = keccak256("tlock-ciphertext-hash");
    bytes32 internal constant PUBLIC_KEY = keccak256("public-key");
    bytes16 internal constant KDF_SALT = bytes16(keccak256("kdf-salt"));

    event ActivityCreated(uint256 indexed activityId, address indexed owner, string name, uint64 createdAt);
    event UploaderAdded(uint256 indexed activityId, address indexed account, address indexed operator);
    event ViewerAdded(uint256 indexed activityId, address indexed account, address indexed operator);
    event ViewerPromotedToUploader(uint256 indexed activityId, address indexed account, address indexed operator);
    event AccountEncryptionRegistered(
        address indexed account, bytes32 publicKey, bytes16 kdfSalt, uint8 kdfVersion, uint8 schemaVersion
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

    function setUp() public {
        registry = new ActivityPhotoRegistry();
        vm.warp(1_700_000_040);
    }

    function _createActivity() internal returns (uint256 activityId) {
        vm.prank(owner);
        activityId = registry.createActivity("Test Activity");
    }

    function _publish(uint256 activityId, address publisher) internal returns (bytes32 assetId) {
        uint32 expectedEpoch = registry.INITIAL_KEY_EPOCH();
        vm.prank(publisher);
        assetId = registry.publishPhoto(
            activityId, PHOTO_TX, METADATA_TX, CONTENT_HASH, METADATA_HASH, uint64(block.timestamp), expectedEpoch
        );
    }

    function _quicknetPublicKey() internal pure returns (bytes memory) {
        return hex"83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";
    }

    function _roundFor(uint64 unlockAt) internal view returns (uint32) {
        uint256 elapsed = uint256(unlockAt) - uint256(registry.QUICKNET_GENESIS_TIME());
        return uint32((elapsed + uint256(registry.QUICKNET_PERIOD()) - 1) / uint256(registry.QUICKNET_PERIOD()) + 1);
    }

    function _capsule(uint64 unlockAt) internal view returns (ActivityPhotoRegistry.TimeCapsuleInput memory) {
        return ActivityPhotoRegistry.TimeCapsuleInput({
            unlockAt: unlockAt,
            targetRound: _roundFor(unlockAt),
            period: registry.QUICKNET_PERIOD(),
            genesisTime: registry.QUICKNET_GENESIS_TIME(),
            chainHash: registry.QUICKNET_CHAIN_HASH(),
            publicKey: _quicknetPublicKey(),
            schemeID: "bls-unchained-g1-rfc9380",
            tlockCiphertextTxId: TLOCK_TX,
            tlockCiphertextHash: TLOCK_HASH
        });
    }

    function _publishCapsule(uint256 activityId, address publisher, uint64 unlockAt)
        internal
        returns (bytes32 assetId)
    {
        ActivityPhotoRegistry.TimeCapsuleInput memory capsule = _capsule(unlockAt);
        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();
        vm.prank(publisher);
        assetId = registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            capsule
        );
    }

    function _member(uint256 index) internal pure returns (address) {
        return address(uint160(1000 + index));
    }

    function test_CreateActivity() public {
        vm.expectEmit(true, true, false, true);
        emit ActivityCreated(1, owner, "Test Activity", uint64(block.timestamp));

        vm.prank(owner);
        uint256 activityId = registry.createActivity("Test Activity");

        assertEq(activityId, 1);
        assertEq(registry.activityCount(), 1);
        assertEq(registry.getActivityIdByOwner(owner), activityId);
        assertEq(registry.getCurrentMemberCount(activityId), 1);

        ActivityPhotoRegistry.Activity memory activity = registry.getActivity(activityId);
        assertEq(activity.owner, owner);
        assertEq(activity.name, "Test Activity");
        assertEq(activity.keyEpoch, registry.INITIAL_KEY_EPOCH());
        assertTrue(activity.exists);
    }

    function test_CreateActivity_RevertsForSecondActivity() public {
        uint256 activityId = _createActivity();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.ActivityAlreadyOwned.selector, owner, activityId));
        registry.createActivity("Another Activity");
    }

    function test_CreateActivity_RevertsForInvalidNames() public {
        vm.startPrank(owner);
        vm.expectRevert(ActivityPhotoRegistry.InvalidActivityName.selector);
        registry.createActivity("");

        vm.expectRevert(ActivityPhotoRegistry.InvalidActivityName.selector);
        registry.createActivity(" leading");

        vm.expectRevert(ActivityPhotoRegistry.InvalidActivityName.selector);
        registry.createActivity("trailing ");

        vm.expectRevert(ActivityPhotoRegistry.InvalidActivityName.selector);
        registry.createActivity("123456789012345678901");

        vm.expectRevert(ActivityPhotoRegistry.InvalidActivityName.selector);
        registry.createActivity("line\nbreak");
        vm.stopPrank();
    }

    function test_CreateActivity_CountsUnicodeCharacters() public {
        string memory twentyCharacters =
            unicode"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀";

        vm.prank(owner);
        uint256 activityId = registry.createActivity(twentyCharacters);
        assertEq(registry.getActivity(activityId).name, twentyCharacters);
    }

    function test_RoleManagement() public {
        uint256 activityId = _createActivity();

        vm.expectEmit(true, true, true, true);
        emit UploaderAdded(activityId, uploader, owner);
        vm.prank(owner);
        registry.addUploader(activityId, uploader);

        vm.expectEmit(true, true, true, true);
        emit ViewerAdded(activityId, viewer, owner);
        vm.prank(owner);
        registry.addViewer(activityId, viewer);

        assertTrue(registry.isUploader(activityId, uploader));
        assertTrue(registry.isViewer(activityId, viewer));
        assertTrue(registry.canPublish(activityId, owner));
        assertTrue(registry.canPublish(activityId, uploader));
        assertFalse(registry.canPublish(activityId, viewer));
        assertTrue(registry.canView(activityId, owner));
        assertTrue(registry.canView(activityId, viewer));
        assertTrue(registry.canView(activityId, uploader));
        assertEq(registry.getCurrentMemberCount(activityId), 3);

        vm.prank(owner);
        registry.removeUploader(activityId, uploader);
        vm.prank(owner);
        registry.removeViewer(activityId, viewer);
        assertFalse(registry.isUploader(activityId, uploader));
        assertFalse(registry.isViewer(activityId, viewer));
        assertTrue(registry.isRemovedMember(activityId, uploader));
        assertTrue(registry.isRemovedMember(activityId, viewer));
        assertEq(registry.getCurrentMemberCount(activityId), 1);
    }

    function test_RoleManagement_RevertsForNonOwner() public {
        uint256 activityId = _createActivity();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.NotActivityOwner.selector, activityId, stranger));
        registry.addUploader(activityId, uploader);
    }

    function test_RoleManagement_RevertsForDuplicateOrCrossRole() public {
        uint256 activityId = _createActivity();
        vm.prank(owner);
        registry.addViewer(activityId, viewer);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.AlreadyAssigned.selector, activityId, viewer));
        registry.addViewer(activityId, viewer);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.AlreadyAssigned.selector, activityId, viewer));
        registry.addUploader(activityId, viewer);
    }

    function test_RoleManagement_RevertsForOwner() public {
        uint256 activityId = _createActivity();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.OwnerCannotBeMember.selector, activityId, owner));
        registry.addUploader(activityId, owner);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.OwnerCannotBeMember.selector, activityId, owner));
        registry.addViewer(activityId, owner);
    }

    function test_MemberLimit_AllowsOwnerPlusNineteen() public {
        uint256 activityId = _createActivity();

        for (uint256 index = 0; index < 19; index++) {
            vm.prank(owner);
            if (index % 2 == 0) {
                registry.addUploader(activityId, _member(index));
            } else {
                registry.addViewer(activityId, _member(index));
            }
        }

        assertEq(registry.getCurrentMemberCount(activityId), registry.MAX_ACTIVITY_MEMBERS());

        uint256 maximum = registry.MAX_ACTIVITY_MEMBERS();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.MemberLimitReached.selector, activityId, maximum));
        registry.addViewer(activityId, _member(19));
    }

    function test_RemovedMemberDoesNotCountAndCannotRejoin() public {
        uint256 activityId = _createActivity();

        for (uint256 index = 0; index < 19; index++) {
            vm.prank(owner);
            registry.addViewer(activityId, _member(index));
        }

        vm.prank(owner);
        registry.removeViewer(activityId, _member(0));
        assertEq(registry.getCurrentMemberCount(activityId), 19);

        vm.prank(owner);
        registry.addUploader(activityId, _member(19));
        assertEq(registry.getCurrentMemberCount(activityId), 20);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.MemberAlreadyRemoved.selector, activityId, _member(0))
        );
        registry.addViewer(activityId, _member(0));
    }

    function test_PromoteViewerToUploader_DoesNotChangeMemberCount() public {
        uint256 activityId = _createActivity();

        for (uint256 index = 0; index < 19; index++) {
            vm.prank(owner);
            registry.addViewer(activityId, _member(index));
        }

        vm.expectEmit(true, true, true, true);
        emit ViewerPromotedToUploader(activityId, _member(0), owner);
        vm.prank(owner);
        registry.promoteViewerToUploader(activityId, _member(0));

        assertTrue(registry.isUploader(activityId, _member(0)));
        assertFalse(registry.isViewer(activityId, _member(0)));
        assertEq(registry.getCurrentMemberCount(activityId), registry.MAX_ACTIVITY_MEMBERS());
    }

    function test_PromoteViewerToUploader_RevertsForNonViewer() public {
        uint256 activityId = _createActivity();

        vm.prank(owner);
        registry.addUploader(activityId, uploader);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.OnlyViewerCanBePromoted.selector, activityId, uploader)
        );
        registry.promoteViewerToUploader(activityId, uploader);
    }

    function test_RegisterAccountEncryption() public {
        vm.expectEmit(true, false, false, true);
        emit AccountEncryptionRegistered(viewer, PUBLIC_KEY, KDF_SALT, 1, 1);

        vm.prank(viewer);
        registry.registerAccountEncryption(PUBLIC_KEY, KDF_SALT, 1, 1);

        ActivityPhotoRegistry.AccountEncryption memory encryption = registry.getAccountEncryption(viewer);
        assertEq(encryption.publicKey, PUBLIC_KEY);
        assertEq(encryption.kdfSalt, KDF_SALT);
        assertEq(encryption.kdfVersion, 1);
        assertEq(encryption.schemaVersion, 1);
        assertTrue(encryption.exists);
    }

    function test_RegisterAccountEncryption_RevertsInvalidParameters() public {
        vm.startPrank(viewer);

        vm.expectRevert(ActivityPhotoRegistry.InvalidPublicKey.selector);
        registry.registerAccountEncryption(bytes32(0), KDF_SALT, 1, 1);

        vm.expectRevert(ActivityPhotoRegistry.InvalidKdfSalt.selector);
        registry.registerAccountEncryption(PUBLIC_KEY, bytes16(0), 1, 1);

        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.InvalidKdfVersion.selector, 2));
        registry.registerAccountEncryption(PUBLIC_KEY, KDF_SALT, 2, 1);

        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.InvalidEncryptionSchemaVersion.selector, 2));
        registry.registerAccountEncryption(PUBLIC_KEY, KDF_SALT, 1, 2);
        vm.stopPrank();
    }

    function test_RegisterAccountEncryption_IsImmutable() public {
        vm.prank(viewer);
        registry.registerAccountEncryption(PUBLIC_KEY, KDF_SALT, 1, 1);

        vm.prank(viewer);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.AccountEncryptionAlreadyRegistered.selector, viewer)
        );
        registry.registerAccountEncryption(keccak256("replacement"), KDF_SALT, 1, 1);
    }

    function test_UpdateKeyManifest_SameEpochAndRotate() public {
        uint256 activityId = _createActivity();
        bytes32 firstManifest = keccak256("manifest-1");
        bytes32 secondManifest = keccak256("manifest-2");
        uint32 currentEpoch = registry.INITIAL_KEY_EPOCH();

        vm.prank(owner);
        registry.updateKeyManifest(activityId, currentEpoch, keccak256("manifest-tx-1"), firstManifest);

        ActivityPhotoRegistry.Activity memory activity = registry.getActivity(activityId);
        assertEq(activity.keyManifestHash, firstManifest);

        vm.prank(owner);
        registry.updateKeyManifest(activityId, currentEpoch + 1, keccak256("manifest-tx-2"), secondManifest);

        activity = registry.getActivity(activityId);
        assertEq(activity.keyEpoch, currentEpoch + 1);
        assertEq(activity.keyManifestHash, secondManifest);
    }

    function test_UpdateKeyManifest_RevertsSkippedEpoch() public {
        uint256 activityId = _createActivity();
        uint32 currentEpoch = registry.INITIAL_KEY_EPOCH();

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.InvalidKeyEpoch.selector, currentEpoch, currentEpoch + 2)
        );
        registry.updateKeyManifest(activityId, currentEpoch + 2, keccak256("manifest-tx"), keccak256("manifest"));
    }

    function test_PublishPhoto() public {
        uint256 activityId = _createActivity();
        vm.prank(owner);
        registry.addUploader(activityId, uploader);

        bytes32 expectedAssetId = registry.computeAssetId(activityId, CONTENT_HASH);
        vm.expectEmit(true, true, false, true);
        emit PhotoPublished(
            expectedAssetId,
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            registry.INITIAL_KEY_EPOCH(),
            uploader
        );

        bytes32 assetId = _publish(activityId, uploader);
        assertEq(assetId, expectedAssetId);

        ActivityPhotoRegistry.Photo memory photo = registry.getPhoto(assetId);
        assertEq(photo.activityId, activityId);
        assertEq(photo.assetType, registry.ASSET_TYPE_PHOTO());
        assertEq(photo.schemaVersion, registry.SCHEMA_VERSION());
        assertEq(photo.photoTxId, PHOTO_TX);
        assertEq(photo.metadataTxId, METADATA_TX);
        assertEq(photo.contentHash, CONTENT_HASH);
        assertEq(photo.metadataHash, METADATA_HASH);
        assertEq(photo.publishedAt, uint64(block.timestamp));
        assertEq(photo.publisher, uploader);
        assertEq(photo.keyEpoch, registry.INITIAL_KEY_EPOCH());
        assertFalse(photo.isTimeCapsule);
    }

    function test_PublishTimeCapsule() public {
        uint256 activityId = _createActivity();
        uint64 unlockAt = uint64(block.timestamp + 1 hours);
        uint32 targetRound = _roundFor(unlockAt);
        bytes32 expectedAssetId = registry.computeAssetId(activityId, CONTENT_HASH);

        vm.expectEmit(true, true, true, true);
        emit TimeCapsulePublished(
            expectedAssetId,
            activityId,
            TLOCK_TX,
            TLOCK_HASH,
            registry.QUICKNET_CHAIN_HASH(),
            registry.QUICKNET_GENESIS_TIME(),
            registry.QUICKNET_PERIOD(),
            unlockAt,
            targetRound,
            owner
        );

        bytes32 assetId = _publishCapsule(activityId, owner, unlockAt);
        assertEq(assetId, expectedAssetId);

        ActivityPhotoRegistry.Photo memory photo = registry.getPhoto(assetId);
        assertTrue(photo.isTimeCapsule);
        assertEq(photo.keyEpoch, registry.INITIAL_KEY_EPOCH());

        ActivityPhotoRegistry.TimeCapsule memory capsule = registry.getTimeCapsule(assetId);
        assertEq(capsule.schemaVersion, registry.TIME_CAPSULE_SCHEMA_VERSION());
        assertEq(capsule.unlockAt, unlockAt);
        assertEq(capsule.targetRound, targetRound);
        assertEq(capsule.period, registry.QUICKNET_PERIOD());
        assertEq(capsule.genesisTime, registry.QUICKNET_GENESIS_TIME());
        assertEq(capsule.chainHash, registry.QUICKNET_CHAIN_HASH());
        assertEq(keccak256(capsule.publicKey), registry.QUICKNET_PUBLIC_KEY_HASH());
        assertEq(keccak256(bytes(capsule.schemeID)), registry.QUICKNET_SCHEME_ID_HASH());
        assertEq(capsule.tlockCiphertextTxId, TLOCK_TX);
        assertEq(capsule.tlockCiphertextHash, TLOCK_HASH);
        assertTrue(capsule.exists);
    }

    function test_PublishTimeCapsule_RevertsForUploader() public {
        uint256 activityId = _createActivity();
        vm.prank(owner);
        registry.addUploader(activityId, uploader);

        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();
        ActivityPhotoRegistry.TimeCapsuleInput memory capsule = _capsule(uint64(block.timestamp + 1 hours));
        vm.prank(uploader);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.NotActivityOwner.selector, activityId, uploader));
        registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            capsule
        );
    }

    function test_PublishTimeCapsule_RevertsPastOrNonMinuteUnlockTime() public {
        uint256 activityId = _createActivity();
        uint64 past = uint64(block.timestamp - 60);
        ActivityPhotoRegistry.TimeCapsuleInput memory pastCapsule = _capsule(past);
        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.InvalidTimeCapsuleUnlockAt.selector, past));
        registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            pastCapsule
        );

        uint64 withSeconds = uint64(block.timestamp + 1 hours + 30);
        ActivityPhotoRegistry.TimeCapsuleInput memory secondsCapsule = _capsule(withSeconds);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.InvalidTimeCapsuleUnlockAt.selector, withSeconds));
        registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            secondsCapsule
        );
    }

    function test_PublishTimeCapsule_ThirtyDayBoundary() public {
        uint256 activityId = _createActivity();
        uint64 unlockAt = uint64(block.timestamp + registry.MAX_TIME_CAPSULE_DURATION());

        bytes32 assetId = _publishCapsule(activityId, owner, unlockAt);
        assertEq(registry.getTimeCapsule(assetId).unlockAt, unlockAt);

        bytes32 secondContentHash = keccak256("second-content");
        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();
        uint64 tooLateUnlockAt = uint64(block.timestamp + registry.MAX_TIME_CAPSULE_DURATION() + 1);
        ActivityPhotoRegistry.TimeCapsuleInput memory tooLateCapsule = _capsule(tooLateUnlockAt);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.InvalidTimeCapsuleUnlockAt.selector, tooLateUnlockAt)
        );
        registry.publishTimeCapsule(
            activityId,
            keccak256("photo-2"),
            keccak256("metadata-2"),
            secondContentHash,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            tooLateCapsule
        );
    }

    function test_PublishTimeCapsule_RevertsWrongRoundAndProtocol() public {
        uint256 activityId = _createActivity();
        uint64 unlockAt = uint64(block.timestamp + 1 hours);

        ActivityPhotoRegistry.TimeCapsuleInput memory wrongRound = _capsule(unlockAt);
        wrongRound.targetRound += 1;
        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();
        uint32 expectedRound = _roundFor(unlockAt);
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                ActivityPhotoRegistry.InvalidTimeCapsuleRound.selector, expectedRound, wrongRound.targetRound
            )
        );
        registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            wrongRound
        );

        ActivityPhotoRegistry.TimeCapsuleInput memory wrongKey = _capsule(unlockAt);
        wrongKey.publicKey = hex"1234";
        vm.prank(owner);
        vm.expectRevert(ActivityPhotoRegistry.InvalidTimeCapsuleProtocol.selector);
        registry.publishTimeCapsule(
            activityId,
            PHOTO_TX,
            METADATA_TX,
            CONTENT_HASH,
            METADATA_HASH,
            uint64(block.timestamp),
            initialEpoch,
            wrongKey
        );
    }

    function test_GetTimeCapsule_RevertsForOrdinaryPhoto() public {
        uint256 activityId = _createActivity();
        bytes32 assetId = _publish(activityId, owner);

        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.TimeCapsuleNotFound.selector, assetId));
        registry.getTimeCapsule(assetId);
    }

    function test_RemovedUploaderLosesUploadAndViewPermissions() public {
        uint256 activityId = _createActivity();
        vm.prank(owner);
        registry.addUploader(activityId, uploader);

        vm.prank(owner);
        registry.removeUploader(activityId, uploader);

        assertFalse(registry.canPublish(activityId, uploader));
        assertFalse(registry.canView(activityId, uploader));
    }

    function test_PublishPhoto_RevertsForViewer() public {
        uint256 activityId = _createActivity();
        vm.prank(owner);
        registry.addViewer(activityId, viewer);

        uint32 expectedEpoch = registry.INITIAL_KEY_EPOCH();
        vm.prank(viewer);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.NotActivityOperator.selector, activityId, viewer));
        registry.publishPhoto(
            activityId, PHOTO_TX, METADATA_TX, CONTENT_HASH, METADATA_HASH, uint64(block.timestamp), expectedEpoch
        );
    }

    function test_PublishPhoto_RevertsDuplicate() public {
        uint256 activityId = _createActivity();
        bytes32 assetId = _publish(activityId, owner);

        uint32 expectedEpoch = registry.INITIAL_KEY_EPOCH();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.AssetAlreadyExists.selector, assetId));
        registry.publishPhoto(
            activityId, PHOTO_TX, METADATA_TX, CONTENT_HASH, METADATA_HASH, uint64(block.timestamp), expectedEpoch
        );
    }

    function test_PublishPhoto_RevertsFutureCaptureTime() public {
        uint256 activityId = _createActivity();
        uint64 capturedAt = uint64(block.timestamp + registry.MAX_CAPTURE_FUTURE_SKEW() + 1);
        uint32 expectedEpoch = registry.INITIAL_KEY_EPOCH();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ActivityPhotoRegistry.InvalidCapturedAt.selector, capturedAt));
        registry.publishPhoto(activityId, PHOTO_TX, METADATA_TX, CONTENT_HASH, METADATA_HASH, capturedAt, expectedEpoch);
    }

    function test_PublishPhoto_RevertsStaleKeyEpoch() public {
        uint256 activityId = _createActivity();
        uint32 initialEpoch = registry.INITIAL_KEY_EPOCH();

        vm.prank(owner);
        registry.updateKeyManifest(activityId, initialEpoch + 1, keccak256("manifest-tx"), keccak256("manifest"));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ActivityPhotoRegistry.InvalidKeyEpoch.selector, initialEpoch + 1, initialEpoch)
        );
        registry.publishPhoto(
            activityId, PHOTO_TX, METADATA_TX, CONTENT_HASH, METADATA_HASH, uint64(block.timestamp), initialEpoch
        );
    }

    function test_ContractRejectsEth() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(registry).call{value: 1 wei}("");
        assertFalse(ok);
        assertEq(address(registry).balance, 0);
    }

    function testFuzz_AssetIdChangesByActivity(bytes32 contentHash) public view {
        vm.assume(contentHash != bytes32(0));
        bytes32 first = registry.computeAssetId(1, contentHash);
        bytes32 second = registry.computeAssetId(2, contentHash);
        assertTrue(first != second);
    }
}
