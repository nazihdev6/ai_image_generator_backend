# 💰 Credit Purchase Flow - Complete Implementation Guide

## 📊 **How Credits Are Added When User Makes a Purchase**

### **Current Implementation (In `/api/pricing/verify-purchase`)**

When a user purchases credits via In-App Purchase (iOS or Android), here's exactly what happens:

---

## **Step-by-Step Flow:**

### **1. User Purchases Credits in App**
```
User buys "10 Credits Pack" for $0.99
└─ App sends verification request to backend
```

### **2. Backend Receives Request**
```http
POST /api/pricing/verify-purchase
Authorization: Bearer <USER_JWT_TOKEN>

{
  "transactionId": "1000000123456789",
  "productId": "com.chitra.credits_10",
  "receipt": "base64_encoded_receipt",
  "platform": "ios",
  "isTestMode": false
}
```

### **3. Backend Verifies Purchase**
- Authenticates user from JWT token
- Validates request data
- Checks product ID → Gets credit amount (10 credits)
- Verifies receipt with Apple/Google
- Checks for duplicate transactions

### **4. Backend Adds Credits to User**

**Current Code (lines 186-201):**
```typescript
// Get current credits
const currentUser = await db
  .select()
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

const currentCredits = currentUser[0]?.credits || 0;
const newBalance = currentCredits + credits;

// Update user with new total
await db
  .update(users)
  .set({
    credits: newBalance,  // OLD_CREDITS + NEW_CREDITS
    updatedAt: new Date()
  })
  .where(eq(users.id, userId));
```

**Example:**
```
User had: 5 credits
Purchased: 10 credits
New balance: 5 + 10 = 15 credits

UPDATE users 
SET credits = 15, updated_at = NOW() 
WHERE id = 123;
```

---

### **5. Backend Records the Transaction**

**Two Tables Are Updated:**

#### **A. `transactions` Table (IAP Record):**
```typescript
await db.insert(transactions).values({
  transactionId: 'apple_1000000123456789',
  userId: 123,
  productId: 'com.chitra.credits_10',
  credits: 10,
  platform: 'ios',
  isTest: false,
  receipt: 'truncated_receipt...',
  verifiedAt: new Date(),
  createdAt: new Date()
});
```

**Database Result:**
```sql
INSERT INTO transactions (transaction_id, user_id, product_id, credits, platform, is_test, receipt, verified_at)
VALUES ('apple_1000000123456789', 123, 'com.chitra.credits_10', 10, 'ios', false, 'receipt...', NOW());
```

#### **B. `credit_histories` Table (Credit Tracking):**
```typescript
await db.insert(creditHistories).values({
  userId: 123,
  amount: 10,
  type: 'CREDIT_PURCHASE',
  createdAt: new Date()
});
```

**Database Result:**
```sql
INSERT INTO credit_histories (user_id, amount, type, created_at)
VALUES (123, 10, 'CREDIT_PURCHASE', NOW());
```

---

### **6. Backend Returns Success**
```json
{
  "success": true,
  "credits": 10,
  "newBalance": 15,
  "isTestPurchase": false,
  "message": "10 credits added successfully"
}
```

---

## **📋 Database State After Purchase**

### **Before Purchase:**
```sql
-- users table
id | email           | credits | ...
123| user@email.com  | 5       | ...

-- credit_histories table
id | user_id | amount | type               | created_at
1  | 123     | 5      | REGISTRATION_BONUS | 2024-01-01 10:00:00

-- transactions table
(empty)
```

### **After Purchase:**
```sql
-- users table (UPDATED)
id | email           | credits | updated_at
123| user@email.com  | 15      | 2024-01-01 11:00:00
                      ↑ INCREASED BY 10

-- credit_histories table (NEW ROW ADDED)
id | user_id | amount | type            | created_at
1  | 123     | 5      | REGISTRATION_BONUS | 2024-01-01 10:00:00
2  | 123     | 10     | CREDIT_PURCHASE | 2024-01-01 11:00:00  ← NEW

-- transactions table (NEW ROW ADDED)
id | transaction_id        | user_id | credits | platform | created_at
1  | apple_1000000123...   | 123     | 10      | ios      | 2024-01-01 11:00:00  ← NEW
```

---

## **🔄 Multiple Purchases Example**

### **User Makes 3 Purchases:**

1. **Registration:** Gets 5 credits
2. **Buys 10 credits:** Total = 15
3. **Buys 100 credits:** Total = 115
4. **Buys 10 credits again:** Total = 125

### **Final Database State:**

**`users` table:**
```sql
id | email           | credits
123| user@email.com  | 125  ← Total of all credits
```

**`credit_histories` table:**
```sql
id | user_id | amount | type
1  | 123     | 5      | REGISTRATION_BONUS
2  | 123     | 10     | CREDIT_PURCHASE
3  | 123     | 100    | CREDIT_PURCHASE
4  | 123     | 10     | CREDIT_PURCHASE

-- SUM of all amounts = 5 + 10 + 100 + 10 = 125 ✅ Matches users.credits
```

**`transactions` table:**
```sql
id | transaction_id | user_id | credits | product_id
1  | apple_123...   | 123     | 10      | com.chitra.credits_10
2  | apple_456...   | 123     | 100     | com.chitra.credits_100
3  | apple_789...   | 123     | 10      | com.chitra.credits_10
```

---

## **💡 Key Points**

### **1. `users.credits` Column:**
- **Always contains the CURRENT TOTAL** of available credits
- Updated with **addition** when credits are purchased
- Updated with **subtraction** when credits are used

### **2. `credit_histories` Table:**
- **Complete audit log** of all credit changes
- Shows:
  - When credits were added (REGISTRATION_BONUS, CREDIT_PURCHASE)
  - When credits were used (CREDIT_USAGE)
  - How many credits in each transaction

### **3. `transactions` Table:**
- **IAP verification record**
- Stores Apple/Google transaction details
- Used for:
  - Preventing duplicate purchases
  - Audit trail
  - Customer support

---

## **🔐 Safety Features**

### **1. Duplicate Transaction Prevention:**
```typescript
// Check if transaction already processed
const existingTransaction = await db
  .select()
  .from(transactions)
  .where(eq(transactions.transactionId, verificationResult.transactionId))
  .limit(1);

if (existingTransaction.length > 0) {
  return NextResponse.json({
    success: false,
    error: 'Receipt already used',
    details: 'This transaction has already been processed'
  }, { status: 400 });
}
```

**Why?** Prevents user from getting credits twice if they retry the same purchase.

### **2. Receipt Verification:**
- iOS: Verified with Apple's servers
- Android: Verified with Google Play's servers
- Only valid purchases add credits

### **3. Test Mode Isolation:**
- Test purchases marked with `isTest: true`
- Can be filtered out from production analytics
- Helpful for debugging

---

## **📊 SQL Queries for Analytics**

### **Get User's Total Credits:**
```sql
SELECT credits FROM users WHERE id = 123;
-- Result: 125
```

### **Get User's Credit History:**
```sql
SELECT * FROM credit_histories 
WHERE user_id = 123 
ORDER BY created_at DESC;
```

### **Calculate Total Purchased (Verification):**
```sql
SELECT SUM(amount) as total_credits
FROM credit_histories
WHERE user_id = 123;
-- Should match users.credits if no credits were spent
```

### **Get All Purchases:**
```sql
SELECT * FROM transactions 
WHERE user_id = 123 AND is_test = false
ORDER BY verified_at DESC;
```

### **Total Revenue Per User:**
```sql
SELECT 
  u.email,
  COUNT(t.id) as total_purchases,
  SUM(t.credits) as total_credits_bought
FROM users u
LEFT JOIN transactions t ON t.user_id = u.id
WHERE t.is_test = false
GROUP BY u.id, u.email;
```

---

## **🛠️ Code Implementation**

### **Full Implementation (Optimized):**

```typescript
// STEP 7: ADD CREDITS TO USER
// Get current credits and calculate new balance
const [currentUser] = await db
  .select()
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

if (!currentUser) {
  return NextResponse.json({ 
    success: false, 
    error: 'User not found' 
  }, { status: 404 });
}

const currentCredits = currentUser.credits || 0;
const newBalance = currentCredits + credits;

// Update user's total credits
await db
  .update(users)
  .set({
    credits: newBalance,
    updatedAt: new Date()
  })
  .where(eq(users.id, userId));

console.log(`💰 Credits updated for user ${userId}: ${currentCredits} → ${newBalance} (+${credits})`);

// STEP 8: SAVE TRANSACTION RECORD
await db.insert(transactions).values({
  transactionId: verificationResult.transactionId!,
  userId: userId,
  productId: productId,
  credits: credits,
  platform: platform,
  isTest: verificationResult.isTestPurchase || false,
  receipt: receipt.substring(0, 100) + '...',
  verifiedAt: new Date(),
  createdAt: new Date()
});

// STEP 9: ADD CREDIT HISTORY ENTRY
await db.insert(creditHistories).values({
  userId: userId,
  amount: credits,
  type: 'CREDIT_PURCHASE',
  createdAt: new Date()
});

console.log(`✅ ${credits} credits added to user ${userId} (${platform})`);

// STEP 10: RETURN SUCCESS
return NextResponse.json({
  success: true,
  credits: credits,
  newBalance: newBalance,
  isTestPurchase: verificationResult.isTestPurchase || false,
  message: `${credits} credits added successfully`
}, { status: 200 });
```

---

## **🎯 Summary**

When a user purchases credits:

1. **✅ Backend verifies** the purchase with Apple/Google
2. **✅ Gets current credits** from `users` table
3. **✅ Calculates new balance** (current + purchased)
4. **✅ Updates `users.credits`** with new total
5. **✅ Records in `transactions`** table (IAP details)
6. **✅ Records in `credit_histories`** table (audit log)
7. **✅ Returns new balance** to app

**Result:** User's credits are immediately available for use! 🎉

---

## **📱 Frontend Integration**

After successful purchase verification, update UI:

```dart
final response = await verifyPurchaseWithBackend(...);

if (response['success'] == true) {
  final int newBalance = response['newBalance'];
  final int creditsAdded = response['credits'];
  
  // Update UI
  setState(() {
    userCredits = newBalance;
  });
  
  // Show success message
  showDialog(
    context: context,
    builder: (_) => AlertDialog(
      title: Text('Success!'),
      content: Text('$creditsAdded credits added!\nNew balance: $newBalance'),
    ),
  );
}
```

---

**The implementation is complete and working! 🚀**
