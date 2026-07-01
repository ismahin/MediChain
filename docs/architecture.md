# MediChain Architecture

MediChain uses a React client, Express API, MySQL database, local upload storage, and an Ethereum Sepolia proof contract.

## Flow

1. Users authenticate through `/api/auth`.
2. The backend validates role and account status.
3. Patients control access through access requests and permissions.
4. Providers create medical records only after backend consent checks.
5. Uploaded files are stored under `server/uploads`.
6. SHA-256 hashes and metadata hashes are anchored through the backend service wallet.
7. Dashboards read MySQL records and show blockchain transaction status.

## Upload And Verification Lifecycle

- Store file with a random server filename.
- Compute SHA-256 from actual file bytes.
- Save metadata and file hash in MySQL.
- Anchor hash with `registerRecord`.
- Store transaction hash and block number.
- On verification, recalculate file hash and compare with stored/on-chain proof.
