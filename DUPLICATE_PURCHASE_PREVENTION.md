# 🛡️ Duplicate Purchase Prevention System

## 🚨 **Problem: Multiple Requests for Same Purchase**

### **Issue:**
When a user makes one purchase, the app sometimes sends **multiple verification requests** to the backend (2-4 requests simultaneously). This caused:

- ❌ Credits added multiple times (10 credits purchase → 30 or 40 credits added)
- ❌ Multiple entries in `credit_histories` table for same purchase
- ❌ User gets more credits than they paid for
- ❌ Revenue loss and accounting issues

### **Example from Vercel Logs:**
```
21:26:01 - 💰 10 credits added to user 3 (ios)
21:26:01 - 💰 10 credits added to user 3 (ios)  ← DUPLICATE
21:26:01 - 💰 10 credits added to user 3 (ios)  ← DUPLICATE
21:26:01 - 💰 10 credits added to user 3 (ios)  ← DUPLICATE

User paid for: 10 credits
User received: 40 credits ❌
```

---

## ✅ **Solution: Multi-Layer Protection**

### **Layer 1: Transaction ID Check (Application Level)**

**Location:** `app/api/pricing/verify-purchase/route.ts` - Lines 85-108

**How it works:**
```typescript
// Layer 1: Check if this exact transaction ID has already been processed
const existingTransaction = await db
  .select()
  .from(transactions)
  .where(eq(transactions.transactionId, transactionId))
  .limit(1);

if (existingTransaction.length > 0) {
  console.log(`⚠️ Duplicate transaction detected (same ID): ${transactionId}`);
  
  return NextResponse.json({
    success: true,
    credits: existingCredits,
    newBalance: currentUserCredits,
    message: 'Transaction already processed'
  });
}
```

**Why this works:**
- ✅ Checks BEFORE expensive Apple/Google verification
- ✅ Uses exact transaction ID matching
- ✅ Returns success to prevent app from retrying
- ✅ Fast database lookup

---

### **Layer 1.5: Time-Based Duplicate Check (StoreKit Bug Protection)**

**Location:** `app/api/pricing/verify-purchase/route.ts` - Lines 110-147

**The Problem:**
StoreKit has a bug where rapid `restorePurchases()` calls generate **different transaction IDs** for the same purchase! Example:

```
Real Purchase #1:
Request 1: transactionId = "2000000875510556"  ← First ID
Request 2: transactionId = "2000000875510654"  ← DIFFERENT ID (same purchase!)
Request 3: transactionId = "2000000875510712"  ← DIFFERENT ID (same purchase!)
```

Layer 1 (transaction ID check) fails because IDs are different!

**How it works:**
```typescript
// Layer 2: Check for recent purchases (same user, same product, within 10 seconds)
const tenSecondsAgo = new Date(Date.now() - 10000);

const recentSimilarPurchase = await db
  .select()
  .from(transactions)
  .where(
    and(
      eq(transactions.userId, userId),
      eq(transactions.productId, productId),
      eq(transactions.platform, platform),
      gte(transactions.verifiedAt, tenSecondsAgo)
    )
  )
  .orderBy(desc(transactions.verifiedAt))
  .limit(1);

if (recentSimilarPurchase.length > 0) {
  const timeDiff = Date.now() - recentSimilarPurchase[0].verifiedAt.getTime();
  console.log(`⚠️ Duplicate purchase detected (time-based): ${productId}`);
  console.log(`   User ${userId} purchased same product ${timeDiff}ms ago`);
  console.log(`   Previous transaction: ${recentSimilarPurchase[0].transactionId}`);
  console.log(`   Current transaction: ${transactionId}`);
  
  return NextResponse.json({
    success: true,
    message: `Duplicate purchase detected - credits already added ${timeDiff}ms ago`
  });
}
```

**Why this works:**
- ✅ Catches duplicates even with different transaction IDs
- ✅ Uses time-based logic: same user + same product + within 10 seconds = duplicate
- ✅ Prevents StoreKit bug from causing multiple credit additions
- ✅ Logs both transaction IDs for debugging

---

### **Layer 2: Database Unique Constraint**

**Location:** `db/schema.ts` - Line 79

```typescript
export const transactions = pgTable("transactions", {
    transactionId: varchar("transaction_id", { length: 255 }).notNull().unique(),
    // ...
});
```

**Database constraint:**
```sql
ALTER TABLE transactions 
ADD CONSTRAINT transactions_transaction_id_unique 
UNIQUE (transaction_id);
```

**Why this works:**
- ✅ Database enforces uniqueness at the lowest level
- ✅ Even if application logic fails, database prevents duplicates
- ✅ Race condition protection - only first INSERT succeeds
- ✅ Other requests get database error and fail gracefully

---

### **Layer 3: Transaction ID Validation**

**Required in request:**
```json
{
  "transactionId": "apple_1000000123456789",  ← MUST be unique per purchase
  "productId": "com.chitra.credits_10",
  "receipt": "base64_receipt",
  "platform": "ios"
}
```

**Flutter app must:**
- ✅ Use `purchaseDetails.purchaseID` as `transactionId`
- ✅ Each real purchase has unique ID from Apple/Google
- ✅ Don't generate random IDs (use actual transaction ID)

---

## 🔄 **Request Flow with Protection**

### **Scenario: App sends 3 duplicate requests**

```
┌─────────────────────────────────────────────────────────────┐
│ Request 1 arrives at 21:26:01.100                           │
│ ├─ Check database for transaction_id                        │
│ ├─ NOT FOUND ✓                                              │
│ ├─ Verify with Apple ✓                                      │
│ ├─ Add 10 credits ✓                                         │
│ └─ INSERT INTO transactions ✓                               │
│ Response: success, newBalance: 15                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Request 2 arrives at 21:26:01.150 (50ms later)              │
│ ├─ Check database for transaction_id                        │
│ ├─ FOUND! ⚠️                                                │
│ └─ Return: "Transaction already processed"                  │
│ Response: success, newBalance: 15 (no credits added)        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Request 3 arrives at 21:26:01.180 (80ms later)              │
│ ├─ Check database for transaction_id                        │
│ ├─ FOUND! ⚠️                                                │
│ └─ Return: "Transaction already processed"                  │
│ Response: success, newBalance: 15 (no credits added)        │
└─────────────────────────────────────────────────────────────┘

Result: ✅ User gets 10 credits (correct!)
        ✅ All 3 requests return success (app happy)
        ✅ No duplicate credits added
```

---

## 📊 **Before vs After**

### **Before Fix:**

**User purchases 10 credits, app sends 4 requests:**

| Request | Credits Added | User Balance |
|---------|---------------|--------------|
| 1       | +10           | 15           |
| 2       | +10 ❌        | 25 ❌        |
| 3       | +10 ❌        | 35 ❌        |
| 4       | +10 ❌        | 45 ❌        |

**Database:**
```sql
-- transactions table (4 rows for same purchase!)
id | transaction_id  | credits
1  | apple_123...    | 10
2  | apple_123...    | 10  ← DUPLICATE
3  | apple_123...    | 10  ← DUPLICATE
4  | apple_123...    | 10  ← DUPLICATE

-- credit_histories table (4 entries!)
id | user_id | amount | type
1  | 3       | 10     | CREDIT_PURCHASE
2  | 3       | 10     | CREDIT_PURCHASE  ← DUPLICATE
3  | 3       | 10     | CREDIT_PURCHASE  ← DUPLICATE
4  | 3       | 10     | CREDIT_PURCHASE  ← DUPLICATE

-- users table
credits: 45  ← WRONG! Should be 15
```

---

### **After Fix:**

**User purchases 10 credits, app sends 4 requests with DIFFERENT transaction IDs (StoreKit bug):**

| Request | Transaction ID   | Credits Added | User Balance | Detection Method      |
|---------|------------------|---------------|--------------|----------------------|
| 1       | 2000000875510556 | +10 ✅        | 15 ✅        | None (first)         |
| 2       | 2000000875510654 | 0 ✅          | 15 ✅        | Time-based (1s ago) ✅|
| 3       | 2000000875510712 | 0 ✅          | 15 ✅        | Time-based (2s ago) ✅|
| 4       | 2000000875510800 | 0 ✅          | 15 ✅        | Time-based (3s ago) ✅|

**Database:**
```sql
-- transactions table (1 row only!)
id | transaction_id  | credits
1  | apple_123...    | 10  ✅

-- credit_histories table (1 entry only!)
id | user_id | amount | type
1  | 3       | 10     | CREDIT_PURCHASE  ✅

-- users table
credits: 15  ✅ CORRECT!
```

---

## 🔍 **Vercel Logs - What to Expect**

### **Before Fix:**
```
21:26:01 POST 200 /api/pricing/verify-purchase
💰 Credits updated for user 3: 5 → 15 (+10)
✅ 10 credits added to user 3 (ios)

21:26:01 POST 200 /api/pricing/verify-purchase
💰 Credits updated for user 3: 15 → 25 (+10)  ❌ DUPLICATE
✅ 10 credits added to user 3 (ios)

21:26:01 POST 200 /api/pricing/verify-purchase
💰 Credits updated for user 3: 25 → 35 (+10)  ❌ DUPLICATE
✅ 10 credits added to user 3 (ios)
```

### **After Fix (with Time-Based Detection):**
```
21:26:01.100 POST 200 /api/pricing/verify-purchase
💰 Credits updated for user 3: 5 → 15 (+10)
✅ 10 credits added to user 3 (ios)

21:26:01.850 POST 200 /api/pricing/verify-purchase
⚠️ Duplicate purchase detected (time-based): com.ai.headshot.photo.generator.credits_10
   User 3 purchased same product 750ms ago
   Previous transaction: 2000000875510556
   Current transaction: 2000000875510654
✅ Returned existing transaction details (no credits added)

21:26:02.200 POST 200 /api/pricing/verify-purchase
⚠️ Duplicate purchase detected (time-based): com.ai.headshot.photo.generator.credits_10
   User 3 purchased same product 1100ms ago
   Previous transaction: 2000000875510556
   Current transaction: 2000000875510712
✅ Returned existing transaction details (no credits added)
```

---

## ⚙️ **Configuration**

### **No Configuration Needed!**

The protection is automatic for all purchases:
- ✅ Works for iOS purchases
- ✅ Works for Android purchases
- ✅ Works for test mode purchases
- ✅ Works for production purchases

### **Database Setup:**

If you haven't run the initial migration, the unique constraint is already in the schema:

```sql
-- Already defined in db/schema.ts
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(255) NOT NULL UNIQUE,  ← Unique constraint
    ...
);
```

If you need to add it manually:
```bash
# Run this SQL in Supabase SQL Editor
ALTER TABLE transactions 
ADD CONSTRAINT transactions_transaction_id_unique 
UNIQUE (transaction_id);
```

Or use the provided script:
```bash
# In scripts/add-transaction-unique-constraint.sql
```

---

## 🧪 **Testing**

### **How to Test Duplicate Prevention:**

1. **Make a purchase in the app**
2. **Check Vercel logs** for duplicate detection messages
3. **Verify database:**

```sql
-- Should only have 1 row per transaction
SELECT 
    transaction_id, 
    COUNT(*) as count
FROM transactions 
GROUP BY transaction_id 
HAVING COUNT(*) > 1;

-- Expected: No rows (no duplicates)
```

4. **Check user credits:**

```sql
-- Get user's credit balance
SELECT credits FROM users WHERE id = 3;

-- Calculate expected vs actual
SELECT 
    u.credits as current_credits,
    SUM(ch.amount) as total_from_history
FROM users u
LEFT JOIN credit_histories ch ON ch.user_id = u.id
WHERE u.id = 3
GROUP BY u.id, u.credits;

-- Should match if no credits were spent
```

---

## 🛠️ **App-Side Recommendations**

### **Flutter App Should:**

1. **Use correct transaction ID:**
```dart
final String transactionId = purchaseDetails.purchaseID!;
// NOT: Random UUID
// NOT: Timestamp-based ID
```

2. **Don't retry immediately on success:**
```dart
if (response['success'] == true) {
  // Complete purchase - don't retry!
  await _iap.completePurchase(purchaseDetails);
}
```

3. **Handle "already processed" gracefully:**
```dart
if (response['message']?.contains('already processed') == true) {
  // This is OK - credits were added before
  showSuccess('Purchase completed successfully!');
  await _iap.completePurchase(purchaseDetails);
}
```

4. **Implement idempotent retry logic:**
```dart
// If verification fails, retry with SAME transaction ID
Future<void> retryVerification(PurchaseDetails purchase) async {
  final sameTransactionId = purchase.purchaseID;  // ← Same ID
  await verifyPurchaseWithBackend(
    transactionId: sameTransactionId,
    ...
  );
}
```

---

## 📋 **Checklist**

Duplicate prevention is enabled when:

- [x] Database has unique constraint on `transactions.transaction_id`
- [x] Backend checks for duplicates BEFORE verification
- [x] Backend returns success (not error) for duplicates
- [x] App uses real transaction ID (not random)
- [x] App doesn't retry on success

---

## 🎯 **Summary**

### **The Fix:**

1. **Early Check:** Detect duplicates BEFORE verification
2. **Database Constraint:** Prevent duplicates at database level
3. **Graceful Response:** Return success for duplicates (not error)

### **Result:**

- ✅ Only first request adds credits
- ✅ Subsequent requests return "already processed"
- ✅ User gets correct amount of credits
- ✅ No app errors
- ✅ Database stays consistent

### **User Experience:**

- User purchases 10 credits
- App might send multiple requests (due to network/retry logic)
- Backend processes only once
- User gets exactly 10 credits ✅
- App shows success message ✅

**Problem solved! 🎉**
