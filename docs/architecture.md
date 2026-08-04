# MediChain Architecture

MediChain uses a React client, Express API, MySQL database, server-managed upload storage, and a configurable EVM proof contract.

## Flow

1. Users authenticate through `/api/auth`.
2. The backend validates role and account status.
3. Patients control access through access requests and permissions.
4. Providers create medical records only after backend consent checks.
5. Uploaded files are stored under `server/uploads`.
6. The record creator signs a proof transaction in MetaMask.
7. The backend validates the mined receipt, contract, event hashes, patient pseudonym, and record type before marking the record anchored.
8. Dashboards read MySQL records and show blockchain transaction status.
9. The client loads non-secret runtime policy and network metadata from `/api/config`; deployment-specific values are not compiled into the UI.

## Upload And Verification Lifecycle

- Store file with a random server filename.
- Compute SHA-256 from actual file bytes.
- Save metadata and file hash in MySQL.
- Anchor hash with `registerRecord`.
- Store transaction hash and block number.
- On verification, recalculate file hash and compare with stored/on-chain proof.
