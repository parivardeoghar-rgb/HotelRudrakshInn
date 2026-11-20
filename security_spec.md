# Security Specification — Hotel Rudraksh Inn Smart Restaurant Management

## 1. Data Invariants
1. **Default-Deny Gate**: All collections are locked down by default (`match /{document=**} { allow read, write: if false; }`).
2. **RBAC Role Authority**: Roles (`super_admin`, `manager`, `cashier`, `waiter`, `kitchen`) are strictly validated against verified `staff_profiles/{uid}` or `staff_invites/{inviteId}` documents created by a verified `super_admin` (including bootstrapped admin `parivardeoghar@gmail.com`). Users cannot self-assign or escalate roles.
3. **PII Isolation**: Staff PII (`email`, `phone` in `staff_profiles`, `staff_invites`) and Guest Folio phone details (`room_folios`) are restricted exclusively to authorized staff or document owners; unauthenticated guests can never read staff lists, bills, or other tables' orders.
4. **Path & ID Hardening**: All single-document operations enforce `isValidId(id)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars) and strict `.size()` limits on every string and array (`items.size() <= 50`).
5. **Temporal Integrity**: Creation timestamps (`createdAt`) and mutation timestamps (`updatedAt`) are enforced against `request.time`.
6. **Terminal State Locking**: Once a `Bill` reaches `Cancelled` or `Paid` (except Admin override) or an `Order` reaches `Completed`/`Cancelled`, unauthorized non-admin staff cannot alter financial totals or line items.
7. **QR Guest Order Integrity**: Guest QR orders (`source == 'qr'`) require an existing `tableId` in `/tables/{tableId}`, start strictly in `status == 'New'`, `billed == false`, and `createdAt == request.time`. Guests can only `get` their specific order ID (never `list` all restaurant orders).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Privilege Escalation (`staff_profiles` create)**: Uninvited user attempts to create `/staff_profiles/{uid}` with `role: "super_admin"`. -> `PERMISSION_DENIED`.
2. **Role Tampering (`staff_profiles` update)**: Waiter attempts to update own `staff_profiles/{uid}` changing `role` to `"manager"`. -> `PERMISSION_DENIED`.
3. **Ghost Field Shadow Update (`orders` update)**: Waiter updates order with extra unallowed field `isVerified: true` or `overridePrice: 0`. -> `PERMISSION_DENIED`.
4. **Email Spoofing (`staff_invites` / admin access)**: Token with `email: "parivardeoghar@gmail.com"` but `email_verified: false`. -> `PERMISSION_DENIED`.
5. **PII Scraping (`staff_profiles` get/list)**: Non-admin waiter or anonymous user attempts to `get` or `list` `/staff_profiles`. -> `PERMISSION_DENIED`.
6. **ID Poisoning (`orders` create)**: Attacker passes a 200-char or slash-injected `orderId`. -> `PERMISSION_DENIED`.
7. **Timestamp Forgery (`bills` create)**: Cashier attempts to backdate `createdAt` on a bill (`createdAt != request.time`). -> `PERMISSION_DENIED`.
8. **Unauthorized Bill Cancellation (`bills` update)**: Waiter or Kitchen staff attempts to set `paymentStatus: "Cancelled"` on a settled bill. -> `PERMISSION_DENIED`.
9. **Terminal Bill Mutation (`bills` update)**: Cashier attempts to reduce `totalAmount` on an already `Paid` bill. -> `PERMISSION_DENIED`.
10. **Orphaned QR Order (`orders` create)**: Anonymous guest submits `source: "qr"` with non-existent `tableId: "FAKE_TABLE"`. -> `PERMISSION_DENIED`.
11. **Guest Order List Scraping (`orders` list)**: Anonymous guest runs `collection(db, 'orders')` list query to read all hotel orders. -> `PERMISSION_DENIED`.
12. **Array Exhaustion (`orders` create)**: Attacker sends 200 items in `order.items` array to exhaust document/memory limits. -> `PERMISSION_DENIED`.
