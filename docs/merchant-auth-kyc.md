# Merchant Authentication and KYC API

This module adds merchant registration, JWT bearer authentication, KYC submission, role checks, and a protected trading-access example.

## Data stores

- PostgreSQL is the application's database. Prisma models merchant accounts and KYC state alongside the existing market-tick models.
- JWT access tokens are signed with `JWT_SECRET` using HS256 and expire after 12 hours. Redis stores token revocations and authentication rate-limit counters.
- No MongoDB service or MongoDB driver is required.

## Configuration

Add the development-only review key to your local `.env`:

```dotenv
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/pricing_engine
REDIS_URL=redis://localhost:6379
ADMIN_API_KEY=use-a-long-random-development-only-secret
JWT_SECRET=generate-a-random-secret-at-least-32-characters-long
```

Keep the real `ADMIN_API_KEY` and market-provider credentials out of Git. The manual review endpoint below is disabled when `NODE_ENV=production`.

Apply the new PostgreSQL migration and generate Prisma Client:

```bash
pnpm install
pnpm exec prisma migrate dev
pnpm typecheck
pnpm build
```

For deployment, use `pnpm exec prisma migrate deploy` to apply committed migrations. Start the existing dependencies and API according to the repository README. With Docker Compose, the API listens on port 5000; local `pnpm dev` uses `PORT` (3000 by default).

## Endpoints

### Register

`POST /api/auth/register`

```json
{
  "email": "merchant@example.com",
  "password": "ChangeThisStrongPassword123!"
}
```

Password must be 12–128 characters. The server always assigns role `MERCHANT`; callers cannot submit their own role or KYC status. Newly registered merchants start with `kycStatus: NOT_SUBMITTED`.

### Login

`POST /api/auth/login`

```json
{
  "email": "merchant@example.com",
  "password": "ChangeThisStrongPassword123!"
}
```

The response contains a signed JWT bearer token. The API validates its signature, issuer, audience, and expiration. Access-token lifetime is 12 hours. Redis tracks revoked token IDs so logout invalidates a token before its natural expiration.

Use the returned token in subsequent requests:

`Authorization: Bearer <accessToken>`

### Current merchant

`GET /api/auth/me`

Requires a valid bearer token. Password hashes are never included in API responses. Account and KYC state are reloaded from PostgreSQL through Prisma for each authenticated request.

### Submit KYC

`POST /api/kyc/submissions`

Requires authentication.

```json
{
  "applicantName": "Example Merchant",
  "documentType": "PASSPORT",
  "providerReference": "reference-from-your-kyc-provider"
}
```

Allowed `documentType` values: `PASSPORT`, `NATIONAL_ID`, `DRIVING_LICENSE`. Submission changes status to `PENDING`, not `VERIFIED`. This demo endpoint does not upload or verify identity documents and does not store a raw document number.

### Review KYC for local Postman testing

`PATCH /api/kyc/admin/merchants/:merchantId/kyc`

Header: `x-admin-api-key: <ADMIN_API_KEY>`

Verify body:

```json
{
  "status": "VERIFIED",
  "providerReference": "approved-provider-reference"
}
```

Reject body:

```json
{
  "status": "REJECTED",
  "rejectionReason": "Identity information could not be verified"
}
```

This development-only route updates the PostgreSQL `Merchant` row through Prisma, returns 404 in production, and must be replaced with an authenticated admin workflow or trusted KYC-provider integration (including webhook signature verification) before production use. Never expose the admin key in a browser or commit it to source control.

### Protected trading-access example

`GET /api/trading/access`

Requires a valid JWT, active account, `MERCHANT` role, and `kycStatus: VERIFIED`. Before KYC approval, the endpoint returns HTTP 403 with code `KYC_NOT_VERIFIED`. This endpoint demonstrates authorization; it does not place actual trades.

### Logout

`POST /api/auth/logout`

Requires a valid bearer token and adds its token ID to a Redis revocation list until the token expires. The same token should then receive HTTP 401.

## Security behavior

- Passwords are hashed with bcrypt (cost factor 12). Existing `scrypt` password hashes are verified during login and upgraded to bcrypt after a successful login.
- Registration/login inputs are validated with Zod.
- PostgreSQL enforces unique merchant email addresses through a Prisma migration.
- Authentication requests are rate limited using Redis.
- JWTs use HS256 with a required strong secret, fixed issuer/audience, expiration, and a unique token ID. Redis revocation checks are performed on authenticated requests.
- Trading access is enforced on the backend, not by frontend visibility.
- Account status and KYC status are read from PostgreSQL through Prisma for protected requests.
- API responses exclude `passwordHash`.
- Provider secrets remain server-side in environment variables.

## Postman smoke test

Import `postman/merchant-kyc-auth.postman_collection.json`. Configure `baseUrl` and `adminApiKey`. Run requests in order:

1. Register merchant.
2. Login.
3. Get current merchant.
4. Submit KYC.
5. Confirm trading access is denied.
6. Use the development-only admin key to verify KYC.
7. Confirm trading access is granted.
8. Logout.
9. Confirm the revoked session is rejected.

The manual KYC approval is only a test substitute; it is not evidence that a real identity document was verified.
