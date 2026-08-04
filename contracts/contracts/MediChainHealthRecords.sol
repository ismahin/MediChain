// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MediChainHealthRecords
/// @notice Stores only tamper-evident proofs for off-chain healthcare records.
/// @dev Never store patient names, diagnoses, files, or other readable medical content on chain.
contract MediChainHealthRecords is AccessControl {
    bytes32 public constant SYSTEM_ADMIN_ROLE = keccak256("SYSTEM_ADMIN_ROLE");
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    error RecordAlreadyExists(bytes32 recordHash);
    error RecordNotFound(bytes32 recordHash);
    error InvalidHash();
    error InvalidAddress();
    error InvalidExpiry();
    error AccessGrantNotFound();
    error InvalidRecordType();

    struct RecordProof {
        bytes32 patientIdHash;
        bytes32 recordHash;
        bytes32 metadataHash;
        uint8 recordType;
        address creator;
        uint256 timestamp;
        bool active;
    }

    struct AccessGrantProof {
        bytes32 patientIdHash;
        address grantee;
        bytes32 permissionHash;
        uint256 expiresAt;
        bool revoked;
        uint256 timestamp;
    }

    mapping(bytes32 => RecordProof) private records;
    mapping(bytes32 => AccessGrantProof) private accessGrants;

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event RecordRegistered(bytes32 indexed patientIdHash, bytes32 indexed recordHash, bytes32 metadataHash, uint8 recordType, address indexed creator, uint256 timestamp);
    event AccessGranted(bytes32 indexed patientIdHash, address indexed grantee, bytes32 indexed permissionHash, uint256 expiresAt);
    event AccessRevoked(bytes32 indexed patientIdHash, address indexed grantee, bytes32 indexed permissionHash);
    event EmergencyAccessRecorded(bytes32 indexed patientIdHash, address indexed requester, bytes32 indexed reasonHash, uint256 timestamp);

    constructor(address initialAdmin) {
        if (initialAdmin == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(SYSTEM_ADMIN_ROLE, initialAdmin);
        _grantRole(AUDITOR_ROLE, initialAdmin);
    }

    function addProvider(address provider) external onlyRole(SYSTEM_ADMIN_ROLE) {
        if (provider == address(0)) revert InvalidAddress();
        _grantRole(PROVIDER_ROLE, provider);
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyRole(SYSTEM_ADMIN_ROLE) {
        _revokeRole(PROVIDER_ROLE, provider);
        emit ProviderRemoved(provider);
    }

    function registerRecord(bytes32 patientIdHash, bytes32 recordHash, bytes32 metadataHash, uint8 recordType) external onlyRoleOrAdmin(PROVIDER_ROLE) {
        if (patientIdHash == bytes32(0) || recordHash == bytes32(0) || metadataHash == bytes32(0)) revert InvalidHash();
        if (recordType == 0 || recordType > 7) revert InvalidRecordType();
        if (records[recordHash].timestamp != 0) revert RecordAlreadyExists(recordHash);

        records[recordHash] = RecordProof({
            patientIdHash: patientIdHash,
            recordHash: recordHash,
            metadataHash: metadataHash,
            recordType: recordType,
            creator: msg.sender,
            timestamp: block.timestamp,
            active: true
        });

        emit RecordRegistered(patientIdHash, recordHash, metadataHash, recordType, msg.sender, block.timestamp);
    }

    function grantAccess(bytes32 patientIdHash, address grantee, bytes32 permissionHash, uint256 expiresAt) external onlyRole(SYSTEM_ADMIN_ROLE) {
        if (patientIdHash == bytes32(0) || permissionHash == bytes32(0)) revert InvalidHash();
        if (grantee == address(0)) revert InvalidAddress();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        bytes32 key = _accessKey(patientIdHash, grantee, permissionHash);
        accessGrants[key] = AccessGrantProof({
            patientIdHash: patientIdHash,
            grantee: grantee,
            permissionHash: permissionHash,
            expiresAt: expiresAt,
            revoked: false,
            timestamp: block.timestamp
        });

        emit AccessGranted(patientIdHash, grantee, permissionHash, expiresAt);
    }

    function revokeAccess(bytes32 patientIdHash, address grantee, bytes32 permissionHash) external onlyRole(SYSTEM_ADMIN_ROLE) {
        bytes32 key = _accessKey(patientIdHash, grantee, permissionHash);
        if (accessGrants[key].timestamp == 0) revert AccessGrantNotFound();
        accessGrants[key].revoked = true;
        emit AccessRevoked(patientIdHash, grantee, permissionHash);
    }

    function recordEmergencyAccess(bytes32 patientIdHash, address requester, bytes32 reasonHash) external onlyRoleOrAdmin(PROVIDER_ROLE) {
        if (patientIdHash == bytes32(0) || reasonHash == bytes32(0)) revert InvalidHash();
        if (requester == address(0)) revert InvalidAddress();
        emit EmergencyAccessRecorded(patientIdHash, requester, reasonHash, block.timestamp);
    }

    function verifyRecord(bytes32 recordHash) external view returns (bool exists, bytes32 patientIdHash, address creator, uint256 timestamp, uint8 recordType, bool active) {
        RecordProof memory proof = records[recordHash];
        exists = proof.timestamp != 0;
        return (exists, proof.patientIdHash, proof.creator, proof.timestamp, proof.recordType, proof.active);
    }

    function getRecord(bytes32 recordHash) external view returns (RecordProof memory) {
        if (records[recordHash].timestamp == 0) revert RecordNotFound(recordHash);
        return records[recordHash];
    }

    function getAccessGrant(bytes32 patientIdHash, address grantee, bytes32 permissionHash) external view returns (AccessGrantProof memory) {
        return accessGrants[_accessKey(patientIdHash, grantee, permissionHash)];
    }

    function isAccessActive(bytes32 patientIdHash, address grantee, bytes32 permissionHash) external view returns (bool) {
        AccessGrantProof memory grant = accessGrants[_accessKey(patientIdHash, grantee, permissionHash)];
        return grant.timestamp != 0 && !grant.revoked && grant.expiresAt > block.timestamp;
    }

    modifier onlyRoleOrAdmin(bytes32 role) {
        if (!hasRole(role, msg.sender) && !hasRole(SYSTEM_ADMIN_ROLE, msg.sender)) {
            _checkRole(role, msg.sender);
        }
        _;
    }

    function _accessKey(bytes32 patientIdHash, address grantee, bytes32 permissionHash) private pure returns (bytes32) {
        return keccak256(abi.encode(patientIdHash, grantee, permissionHash));
    }
}
