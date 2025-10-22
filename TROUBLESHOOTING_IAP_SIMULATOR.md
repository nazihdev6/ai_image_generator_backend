# 🚨 iOS Simulator IAP Error: Receipt Verification Failed (21002)

## **Problem**

When testing In-App Purchases on iOS Simulator with StoreKit Configuration, you see this error in Vercel logs:

```
❌ Apple verification failed with status: 21002
❌ Receipt verification failed
```

---

## **Root Cause**

**iOS Simulator does NOT have valid App Store receipts!**

Apple error code `21002` means: **"The data in the receipt-status property was malformed or missing."**

This happens because:
- iOS Simulator doesn't communicate with real App Store servers
- Simulator receipts are mock/local receipts from StoreKit Configuration
- Apple's verification servers (`buy.itunes.apple.com` or `sandbox.itunes.apple.com`) reject these receipts

---

## **✅ Solution 1: Use Test Mode (Recommended for Simulator)**

The backend supports **test mode** which bypasses Apple verification for local testing.

### **In Your Flutter App:**

Change this line in `IAPManager._verifyPurchaseWithBackend()`:

```dart
final requestBody = {
  'transactionId': transactionId,
  'productId': productId,
  'receipt': receipt,
  'platform': 'ios',
  'isTestMode': true,  // ✅ SET TO TRUE FOR SIMULATOR
};
```

### **What Happens:**
- Backend skips Apple verification
- Credits are added immediately
- Transaction is marked as `isTest: true` in database
- Perfect for local development and testing

### **Requirements:**
- `ALLOW_TEST_PURCHASES=true` must be set in Vercel environment variables
- This is ONLY for development/testing - set to `false` in production

---

## **✅ Solution 2: Test on Real iOS Device**

For production-like testing with real Apple verification:

### **Setup:**

1. **Create Sandbox Tester Account:**
   - Go to [App Store Connect](https://appstoreconnect.apple.com/)
   - Users and Access → Sandbox Testers
   - Click "+" to add a new tester
   - Use a NEW email (can be fake, doesn't need to exist)
   - Set password and other details

2. **On Your iOS Device:**
   - Settings → App Store → Sign Out (if signed in)
   - **DON'T** sign in with sandbox account yet!

3. **In Your Flutter App:**
   ```dart
   final requestBody = {
     'transactionId': transactionId,
     'productId': productId,
     'receipt': receipt,
     'platform': 'ios',
     'isTestMode': false,  // ✅ FALSE for real verification
   };
   ```

4. **Test Purchase:**
   - Run app on real device
   - Initiate purchase
   - When prompted, sign in with **Sandbox Tester** account
   - Complete purchase
   - Backend verifies with Apple's sandbox servers

5. **Backend Environment:**
   ```env
   APPLE_ENV=sandbox  # Use sandbox for testing
   APPLE_SHARED_SECRET=your_shared_secret_from_app_store_connect
   ```

---

## **Comparison**

| Method | Pros | Cons |
|--------|------|------|
| **Test Mode (Simulator)** | ✅ Fast testing<br>✅ No Apple ID needed<br>✅ Works on simulator | ❌ Doesn't test Apple verification<br>❌ Not production-like |
| **Real Device (Sandbox)** | ✅ Tests real Apple flow<br>✅ Production-like<br>✅ Tests full integration | ❌ Requires real device<br>❌ Requires sandbox tester<br>❌ Slower testing |

---

## **Quick Fix for Current Error**

**Right now, to fix the error:**

### **Option A: Enable Test Mode (Quick)**

In your Flutter app, update the verification request:

```dart
final requestBody = {
  'transactionId': transactionId,
  'productId': productId,
  'receipt': receipt,
  'platform': 'ios',
  'isTestMode': true,  // 👈 CHANGE THIS TO TRUE
};
```

Then test again on simulator. The error will disappear and credits will be added.

### **Option B: Automatic Detection**

Add this helper to automatically detect simulator:

```dart
class IAPManager {
  // Add this property at the top
  bool get _isDebugMode => true; // Or use kDebugMode from 'package:flutter/foundation.dart'
  
  Future<bool> _verifyPurchaseWithBackend(PurchaseDetails purchaseDetails) async {
    // ...
    
    final requestBody = {
      'transactionId': transactionId,
      'productId': productId,
      'receipt': receipt,
      'platform': platform,
      'isTestMode': _isDebugMode,  // 👈 Automatically true in debug mode
    };
    
    // ...
  }
}
```

Or use Flutter's built-in:
```dart
import 'package:flutter/foundation.dart';

final requestBody = {
  // ...
  'isTestMode': kDebugMode,  // true in debug, false in release
};
```

---

## **Verify Backend Environment**

Make sure your Vercel environment has:

```env
ALLOW_TEST_PURCHASES=true
```

**Check in Vercel:**
1. Go to your project in Vercel Dashboard
2. Settings → Environment Variables
3. Ensure `ALLOW_TEST_PURCHASES` is set to `true`

---

## **Expected Behavior**

### **With `isTestMode: true`:**

**Vercel Logs:**
```
🧪 TEST MODE: Accepting purchase without verification
✅ 10 credits added to user 123 (ios)
```

**Response:**
```json
{
  "success": true,
  "credits": 10,
  "newBalance": 110,
  "isTestPurchase": true,
  "message": "TEST: 10 credits added (StoreKit/Play simulator)"
}
```

### **With `isTestMode: false` (Real Device):**

**Vercel Logs:**
```
🔐 PRODUCTION: Verifying ios receipt
✅ 10 credits added to user 123 (ios)
```

**Response:**
```json
{
  "success": true,
  "credits": 10,
  "newBalance": 110,
  "isTestPurchase": false,
  "message": "10 credits added successfully"
}
```

---

## **Apple Error Codes Reference**

| Code | Meaning | Solution |
|------|---------|----------|
| `0` | Success | ✅ Receipt valid |
| `21000` | App Store cannot read receipt | Check receipt format |
| `21002` | Receipt data malformed | **Use test mode on simulator** |
| `21003` | Receipt authentication failed | Check `APPLE_SHARED_SECRET` |
| `21004` | Shared secret doesn't match | Update `APPLE_SHARED_SECRET` |
| `21005` | Receipt server unavailable | Retry later |
| `21007` | Sandbox receipt → Production | Backend auto-retries with sandbox |
| `21008` | Production receipt → Sandbox | Set `APPLE_ENV=production` |

---

## **Summary**

**For Simulator Testing:**
```dart
'isTestMode': true  // ✅ Bypass Apple verification
```

**For Real Device Testing:**
```dart
'isTestMode': false  // ✅ Use Apple sandbox verification
```

**For Production:**
```dart
'isTestMode': false  // ✅ Use Apple production verification
APPLE_ENV=production  // In Vercel
```

---

## **Next Steps**

1. ✅ **Immediate fix:** Set `isTestMode: true` in your Flutter app
2. ✅ **Test on simulator:** Verify credits are added
3. ✅ **Later:** Test on real device with sandbox account for production-like testing
4. ✅ **Production:** Set `isTestMode: false` and `APPLE_ENV=production`

The backend is ready and working correctly! The error is just because simulator receipts aren't real Apple receipts. 🚀
