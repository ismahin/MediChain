# Security Notes

## Authentication

Passwords are hashed with bcrypt. The API uses JWT access tokens and role middleware. Frontend route guards are convenience only; backend permissions are authoritative.

## Files

Uploads use random filenames, MIME allow-listing, PDF/PNG/JPEG signature validation, and a 10 MB size limit. Rejected uploads are removed, and the upload directory is not exposed statically. Downloads go through authenticated routes and category-scoped consent checks.

## Blockchain Keys

Private keys are read only from `.env` files. They must never use the `VITE_` prefix and must never be committed.

## Permissions

Patients approve, reject, and revoke access. Providers can view or create records only when the backend finds an active, unexpired permission.

## Limitations

This is a demo project. It is not HIPAA-certified, not production medical software, and not suitable for emergency medical decisions.
