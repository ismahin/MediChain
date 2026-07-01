# Blockchain Design

The smart contract stores proof metadata only.

## On Chain

- `patientIdHash`
- `recordHash`
- `metadataHash`
- `recordType`
- creator wallet
- timestamps
- permission hashes
- emergency access reason hashes

## Off Chain

- names
- emails
- diagnoses
- prescriptions
- readable reports
- files
- local file paths
- consent UI state and application workflow data

## Roles

- `DEFAULT_ADMIN_ROLE`: contract administration.
- `SYSTEM_ADMIN_ROLE`: backend service/deployment administration.
- `PROVIDER_ROLE`: verified doctors, hospitals, and laboratories.
- `AUDITOR_ROLE`: reserved for audit reads and future monitoring.

Raw medical data is not stored on public blockchain because it is sensitive, expensive, and not removable.
