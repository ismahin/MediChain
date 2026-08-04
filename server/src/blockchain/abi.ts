export const mediChainAbi = [
  "error RecordAlreadyExists(bytes32 recordHash)",
  "error RecordNotFound(bytes32 recordHash)",
  "error InvalidHash()",
  "error InvalidAddress()",
  "error InvalidExpiry()",
  "error AccessGrantNotFound()",
  "error InvalidRecordType()",
  "function registerRecord(bytes32 patientIdHash, bytes32 recordHash, bytes32 metadataHash, uint8 recordType)",
  "function grantAccess(bytes32 patientIdHash, address grantee, bytes32 permissionHash, uint256 expiresAt)",
  "function revokeAccess(bytes32 patientIdHash, address grantee, bytes32 permissionHash)",
  "function recordEmergencyAccess(bytes32 patientIdHash, address requester, bytes32 reasonHash)",
  "function verifyRecord(bytes32 recordHash) view returns (bool exists, bytes32 patientIdHash, address creator, uint256 timestamp, uint8 recordType, bool active)",
  "event RecordRegistered(bytes32 indexed patientIdHash, bytes32 indexed recordHash, bytes32 metadataHash, uint8 recordType, address indexed creator, uint256 timestamp)"
];
