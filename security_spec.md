# ZENVEGO Security Specification (Phase 2 — Hardened Production Invariants)

> Architecture: Application A (ZENVEGO Public Marketplace: Customer, Grower, Delivery Partner, Bulk Buyer — zero Admin UI/routes/APIs) + isolated Application B (ZEN ADMIN — separate app/build/deployment).

## 1. Enforced Security Invariants
1. **Identity Isolation & Non-Escalatable Roles**:
   - `/users/{userId}`, `/users/{userId}/addresses/*`, `/users/{userId}/cart/*`, `/users/{userId}/support_tickets/*`, and `/users/{userId}/wallet_transactions/*` are strictly owner-scoped.
   - `activeRole` and `registeredPortals` accept only `['customer', 'grower', 'delivery', 'bulk']`. No `admin` role or privilege flag can ever be written in public user docs.
2. **Wallet Tamper Protection**:
   - Users CANNOT increase `users/{uid}.walletBalance` from the client (initial value must be `0`; client updates may only preserve or debit balance during checkout).
   - Manual UPI top-ups create a `wallet_transactions` record with `status: 'pending_verification'` and NEVER auto-credit `walletBalance`.
3. **Zero KYC Self-Approval & Private PII Separation**:
   - Public `/grower_profiles/{growerId}` contains storefront fields only (zero phone, ID last-4, selfies, or farm proof photos).
   - Private `/grower_kyc/{growerId}` holds sensitive grower KYC documents and is strictly readable only by the owner and authorized reviewers.
   - Growers MUST submit with `verificationStatus: 'pending'` / `reviewStatus: 'pending'`; Delivery Partners MUST submit with `kycStatus: 'submitted'`. Self-escalation to `'verified'` is denied by Firestore rules.
4. **Honest Payment & Refund Verification**:
   - Direct UPI UTR submissions return `verified: false`, `paymentStatus: 'pending_upi_review'` (bank reconciliation required — never fake auto-verified).
   - `/api/checkout/validate` computes all amounts in integer paise (`1000 bps` = 10% platform commission, 90% grower net) and returns an HMAC-SHA256 `quoteSignature` verified by `/api/payments/create`.
   - Customers CANNOT mutate `paymentStatus` or `paymentRef` after order creation; customer updates are restricted to pre-pickup cancellation only.
   - `POST /api/refunds` requires authorized operator authentication (returns HTTP `403` for non-admin callers).
5. **Verified & Assigned Delivery Partner Enforcement**:
   - Open `/delivery_assignments` and `ready_for_pickup` `/seller_orders` are readable ONLY by delivery partners with `delivery_profiles/{uid}.kycStatus == 'verified'` (eliminating customer dropoff coordinate leaks).
   - Delivery mutations on `/orders/{orderId}` and `/seller_orders/{id}` require both `kycStatus == 'verified'` AND matching `assignedPartnerId == request.auth.uid`.
6. **Settlement & Audit Integrity**:
   - Growers are strictly read-only on `/settlements/{id}` and can NEVER self-mark payouts as `'settled'`.
   - `/audit_logs/{id}` is append-only for authorized operators and unreadable/unwritable by public marketplace accounts.
7. **Terminal State & Temporal Integrity**:
   - Once an `order`, `seller_order`, or `delivery_assignment` reaches `'delivered'`, `'cancelled'`, or `'rejected'`, no further client mutations are allowed.
   - `createdAt == request.time` on creation and `updatedAt == request.time` on updates; `createdAt` and ownership IDs are immutable.
