# Gift codes issued only after confirmed funding

New gift payments have two different identifiers:

- `reference`: a `GP-...` internal payment tracking reference, created immediately.
- `giftId`: a shareable `2S-...` claim code, initially `null`. It is generated and
  persisted only in the same database update that confirms crypto funding.

Do not label `reference` as a gift ID or let users share it as a claim code.
Only gift IDs are accepted by the recipient claim endpoint.

## Frontend integration

1. Call `POST /v1/payments` with `type: "gift"`. The response contains deposit
   instructions, `payment.id`, `payment.reference`, and `payment.giftId: null`.
2. Show the deposit address and crypto amount. Do not show a gift-code field yet.
3. Poll `GET /v1/payments/{payment.reference}`. The tracking reference never
   changes. Alternatively, your server can consume the signed
   `payment.confirmed` webhook, which also contains `payment.giftId`.
4. When `status` is `confirmed` and `giftId` is non-null, show the code for sharing.
   Merely detecting a transaction (`confirming`) does not issue a gift code.
5. A recipient can read `GET /v1/payments/gifts/{giftId}` and claim through
   `POST /v1/payments/gifts/{giftId}/claim/confirm` with verified bank details.

Example creation response (abridged):

```json
{"payment":{"id":"pay_...","reference":"GP-ABC234","status":"pending","giftId":null}}
```

Example confirmed response (abridged):

```json
{"payment":{"id":"pay_...","reference":"GP-ABC234","status":"confirmed","giftId":"2S-XYZ789"}}
```

The repository's hosted payment page displays the funded code and passes it as
`giftId` in the success callback URL. External frontends/bots must also use the
new field. The deprecated `POST /v1/gifts/save` now returns HTTP 410 rather than
creating gift codes before payment. `autoSettle` is not supported for normal gifts.

## Deployment order

1. Back up the database and apply
   `src/services/payment-engine/migrations/012_defer_gift_ids_until_confirmation.sql`
   **before** deploying this backend if `gift_id` does not already exist. It adds
   a nullable, unique `gift_id` column and preserves the original distributed
   codes of existing funded gifts. If the column was added manually, run only
   the migration's backfill `UPDATE`, then verify funded gifts have a `gift_id`.
2. Rebuild/restart the backend; update external frontends to use `giftId` for
   display and claiming, while retaining `reference` for payment polling.
3. Test with a sandbox gift: creation and `confirming` must have no code; after
   confirmation the same payment must contain one stable code and await claim.

Deployment does not run this migration automatically. Do not rerun its `ALTER`
statement on a database where `gift_id` already exists, and do not recreate
existing gifts or rerun a new batch to perform the backfill.

## Manual event scripts

Operator-only gift scripts can still authorize funded gifts without a real
deposit. They must explicitly confirm the payment through the repository to
issue the code, and run only after the migration. Their output is `giftId`, not
the internal tracking reference. Do not expose these scripts as an unpaid user
gift-creation endpoint.
