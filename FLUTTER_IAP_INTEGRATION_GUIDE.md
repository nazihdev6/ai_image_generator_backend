# Flutter In-App Purchase Integration Guide

## 🚨 **ISSUE: Purchase Successful but Credits Not Added**

The Flutter app completed the in-app purchase successfully (StoreKit on iOS / Google Play on Android), but the backend didn't receive the verification request. This means **the app is not calling the backend API after the purchase completes**.

---

## 📱 **Required Flutter Implementation**

### **Dependencies**

Add to `pubspec.yaml`:

```yaml
dependencies:
  in_app_purchase: ^3.1.11  # Official Flutter IAP plugin
  http: ^1.1.0              # For API calls
```

Run:
```bash
flutter pub get
```

---

### **Step 1: After Purchase Completes**

When the in-app purchase transaction finishes successfully, you **MUST** call the backend verification endpoint:

```dart
import 'package:in_app_purchase/in_app_purchase.dart';
import 'dart:convert';
import 'dart:io';

Future<void> handlePurchaseSuccess(PurchaseDetails purchaseDetails) async {
  try {
    // 1. Get the receipt/verification data
    final String verificationData = purchaseDetails.verificationData.serverVerificationData;
    
    // 2. Get the transaction ID
    final String transactionId = purchaseDetails.purchaseID ?? 'unknown_${DateTime.now().millisecondsSinceEpoch}';
    
    // 3. Get the product ID
    final String productId = purchaseDetails.productID;
    
    // 4. Determine platform
    final String platform = Platform.isIOS ? 'ios' : 'android';
    
    // 5. Call backend verification
    await verifyPurchaseWithBackend(
      transactionId: transactionId,
      productId: productId,
      receipt: verificationData,
      platform: platform,
    );
    
  } catch (e) {
    print('❌ Error handling purchase: $e');
  }
}
```

---

### **Step 2: Call Backend Verification Endpoint**

**Endpoint:** `POST https://your-backend-domain.vercel.app/api/pricing/verify-purchase`

**Headers:**
```
Authorization: Bearer <USER_JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**
```json
{
  "transactionId": "1000000123456789",
  "productId": "com.chitra.credits_10",
  "receipt": "MIITtQYJKoZIhvcNAQcCoIITpjCCE6ICAQExCzAJ...",
  "platform": "ios",
  "isTestMode": false
}
```

**Important Notes:**
- `transactionId`: Get from `purchaseDetails.purchaseID`
- `productId`: Must match one of the product IDs defined in the backend (see below)
- `receipt`: Get from `purchaseDetails.verificationData.serverVerificationData`
- `platform`: `"ios"` for iOS, `"android"` for Android
- `isTestMode`: Set to `true` ONLY for testing. Set to `false` for real App Store/Play Store purchases.

---

### **Step 3: Full Flutter Implementation Example**

```dart
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:http/http.dart' as http;

class IAPManager {
  static final IAPManager _instance = IAPManager._internal();
  factory IAPManager() => _instance;
  IAPManager._internal();

  final InAppPurchase _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  
  // Your backend URL
  static const String backendUrl = 'https://your-backend-domain.vercel.app';
  
  // Product IDs
  static const String product10Credits = Platform.isIOS 
      ? 'com.chitra.credits_10' 
      : 'credits_10';
  static const String product100Credits = Platform.isIOS 
      ? 'com.chitra.credits_100' 
      : 'credits_100';
  static const String product1000Credits = Platform.isIOS 
      ? 'com.chitra.credits_1000' 
      : 'credits_1000';

  /// Initialize IAP and listen to purchase updates
  Future<void> initialize() async {
    final bool available = await _iap.isAvailable();
    if (!available) {
      print('❌ In-App Purchase not available');
      return;
    }

    // Listen to purchase updates
    _subscription = _iap.purchaseStream.listen(
      _onPurchaseUpdate,
      onDone: () => _subscription?.cancel(),
      onError: (error) => print('❌ Purchase stream error: $error'),
    );

    print('✅ IAP Manager initialized');
  }

  /// Handle purchase updates
  void _onPurchaseUpdate(List<PurchaseDetails> purchaseDetailsList) {
    for (var purchaseDetails in purchaseDetailsList) {
      print('📦 Purchase update: ${purchaseDetails.status}');
      
      switch (purchaseDetails.status) {
        case PurchaseStatus.pending:
          _showPendingUI();
          break;
        case PurchaseStatus.purchased:
        case PurchaseStatus.restored:
          _handlePurchased(purchaseDetails);
          break;
        case PurchaseStatus.error:
          _handleError(purchaseDetails);
          break;
        case PurchaseStatus.canceled:
          _handleCanceled(purchaseDetails);
          break;
        default:
          break;
      }

      // Complete pending purchases
      if (purchaseDetails.pendingCompletePurchase) {
        _iap.completePurchase(purchaseDetails);
      }
    }
  }

  /// Handle successful purchase
  Future<void> _handlePurchased(PurchaseDetails purchaseDetails) async {
    print('✅ Purchase successful: ${purchaseDetails.productID}');

    // ⚠️ CRITICAL: Verify with backend BEFORE completing purchase
    final success = await _verifyPurchaseWithBackend(purchaseDetails);

    if (success) {
      print('✅ Backend verification successful');
      // Complete the purchase
      await _iap.completePurchase(purchaseDetails);
      _showSuccessUI();
    } else {
      print('❌ Backend verification failed');
      _showErrorUI('Verification failed. Please contact support.');
    }
  }

  /// Handle purchase error
  void _handleError(PurchaseDetails purchaseDetails) {
    print('❌ Purchase failed: ${purchaseDetails.error}');
    _showErrorUI(purchaseDetails.error?.message ?? 'Purchase failed');
  }

  /// Handle canceled purchase
  void _handleCanceled(PurchaseDetails purchaseDetails) {
    print('⚠️ Purchase canceled');
    _showCanceledUI();
  }

  /// Verify purchase with backend
  Future<bool> _verifyPurchaseWithBackend(PurchaseDetails purchaseDetails) async {
    try {
      // 1. Get verification data (receipt)
      final String receipt = purchaseDetails.verificationData.serverVerificationData;
      
      // 2. Get transaction ID
      final String transactionId = purchaseDetails.purchaseID ?? 
          'unknown_${DateTime.now().millisecondsSinceEpoch}';
      
      // 3. Get product ID
      final String productId = purchaseDetails.productID;
      
      // 4. Determine platform
      final String platform = Platform.isIOS ? 'ios' : 'android';
      
      // 5. Get user token from your auth system
      final String? userToken = await _getUserToken();
      if (userToken == null) {
        print('❌ No user token found');
        return false;
      }
      
      // 6. Prepare request
      final url = Uri.parse('$backendUrl/api/pricing/verify-purchase');
      
      final requestBody = {
        'transactionId': transactionId,
        'productId': productId,
        'receipt': receipt,
        'platform': platform,
        'isTestMode': false, // Set to true ONLY for testing
      };
      
      print('📤 Sending verification request for $productId');
      print('   Transaction ID: $transactionId');
      print('   Platform: $platform');
      
      // 7. Send request
      final response = await http.post(
        url,
        headers: {
          'Authorization': 'Bearer $userToken',
          'Content-Type': 'application/json',
        },
        body: json.encode(requestBody),
      );
      
      print('📥 Backend response status: ${response.statusCode}');
      print('📥 Backend response body: ${response.body}');
      
      // 8. Handle response
      if (response.statusCode == 200) {
        final Map<String, dynamic> responseData = json.decode(response.body);
        
        if (responseData['success'] == true) {
          final int credits = responseData['credits'] ?? 0;
          final int newBalance = responseData['newBalance'] ?? 0;
          final String message = responseData['message'] ?? 'Credits added';
          
          print('✅ $message');
          print('✅ Credits added: $credits');
          print('✅ New balance: $newBalance');
          
          // Update UI with new balance
          _updateCreditsUI(newBalance, credits);
          
          return true;
        }
      }
      
      // Handle error response
      final Map<String, dynamic> errorData = json.decode(response.body);
      final String errorMessage = errorData['error'] ?? 'Unknown error';
      final String? details = errorData['details'];
      
      print('❌ Backend verification failed: $errorMessage');
      if (details != null) {
        print('   Details: $details');
      }
      
      return false;
      
    } catch (e, stackTrace) {
      print('❌ Error verifying purchase: $e');
      print('Stack trace: $stackTrace');
      return false;
    }
  }

  /// Get user token from your auth system
  Future<String?> _getUserToken() async {
    // TODO: Implement this - get JWT token from your auth system
    // Example: return await AuthService.instance.getToken();
    // For now, returning null - you must implement this!
    print('⚠️ WARNING: _getUserToken() not implemented!');
    return null;
  }

  /// Update credits in UI
  void _updateCreditsUI(int newBalance, int creditsAdded) {
    // TODO: Implement UI update
    // Example: Use a state management solution (Provider, Riverpod, Bloc, etc.)
    print('🔄 Update UI: New balance = $newBalance, Added = $creditsAdded');
  }

  /// Show pending UI
  void _showPendingUI() {
    print('⏳ Purchase pending...');
    // TODO: Show loading indicator
  }

  /// Show success UI
  void _showSuccessUI() {
    print('✅ Purchase completed successfully!');
    // TODO: Show success message
  }

  /// Show error UI
  void _showErrorUI(String message) {
    print('❌ Error: $message');
    // TODO: Show error dialog
  }

  /// Show canceled UI
  void _showCanceledUI() {
    print('⚠️ Purchase canceled');
    // TODO: Show canceled message
  }

  /// Buy a product
  Future<void> buyProduct(String productId) async {
    try {
      // 1. Query product details
      final ProductDetailsResponse response = await _iap.queryProductDetails({productId});
      
      if (response.error != null) {
        print('❌ Error querying products: ${response.error}');
        return;
      }
      
      if (response.productDetails.isEmpty) {
        print('❌ Product not found: $productId');
        return;
      }
      
      final ProductDetails productDetails = response.productDetails.first;
      
      // 2. Create purchase param
      final PurchaseParam purchaseParam = PurchaseParam(
        productDetails: productDetails,
      );
      
      // 3. Initiate purchase
      print('🛒 Initiating purchase for: ${productDetails.id}');
      final bool success = await _iap.buyConsumable(
        purchaseParam: purchaseParam,
        autoConsume: false, // We'll complete after backend verification
      );
      
      if (!success) {
        print('❌ Failed to initiate purchase');
      }
      
    } catch (e) {
      print('❌ Error buying product: $e');
    }
  }

  /// Restore purchases (iOS only)
  Future<void> restorePurchases() async {
    try {
      await _iap.restorePurchases();
      print('🔄 Restore purchases initiated');
    } catch (e) {
      print('❌ Error restoring purchases: $e');
    }
  }

  /// Dispose
  void dispose() {
    _subscription?.cancel();
  }
}
```

### **Usage Example**

```dart
// In your main.dart or app initialization
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Initialize IAP
  await IAPManager().initialize();
  
  runApp(MyApp());
}

// In your purchase screen
class PurchaseScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ElevatedButton(
          onPressed: () {
            IAPManager().buyProduct(IAPManager.product10Credits);
          },
          child: Text('Buy 10 Credits - \$0.99'),
        ),
        ElevatedButton(
          onPressed: () {
            IAPManager().buyProduct(IAPManager.product100Credits);
          },
          child: Text('Buy 100 Credits - \$4.99'),
        ),
        ElevatedButton(
          onPressed: () {
            IAPManager().buyProduct(IAPManager.product1000Credits);
          },
          child: Text('Buy 1000 Credits - \$9.99'),
        ),
      ],
    );
  }
}
```

---

## 🎯 **Valid Product IDs**

The backend recognizes these product IDs (from `lib/constants.ts`):

```typescript
export const PRODUCT_CREDITS_MAP: Record<string, number> = {
  // iOS Product IDs (must match App Store Connect)
  'com.chitra.credits_10': 10,
  'com.chitra.credits_100': 100,
  'com.chitra.credits_1000': 1000,
  
  // Android Product IDs (must match Google Play Console)
  'credits_10': 10,
  'credits_100': 100,
  'credits_1000': 1000
};
```

**⚠️ Important:** Your iOS product IDs in App Store Connect **MUST** match the keys above (e.g., `com.chitra.credits_10`).

---

## 🧪 **Testing**

### **iOS: Testing with StoreKit Configuration**

1. Create a StoreKit Configuration file in Xcode
2. Add your product IDs to the configuration
3. Set `isTestMode: true` in the request:

```dart
final requestBody = {
  'transactionId': transactionId,
  'productId': productId,
  'receipt': receipt,
  'platform': 'ios',
  'isTestMode': true,  // ✅ Enable for StoreKit testing
};
```

### **Android: Testing with Google Play Console**

1. Create test products in Google Play Console
2. Add test users (license testers)
3. Set `isTestMode: false` (Google test purchases use real sandbox)

```dart
final requestBody = {
  'transactionId': transactionId,
  'productId': productId,
  'receipt': receipt,
  'platform': 'android',
  'isTestMode': false,  // Google handles test mode automatically
};
```

### **Backend Environment**

Ensure `ALLOW_TEST_PURCHASES=true` in backend environment variables for testing.

---

## 📊 **Backend Response**

### **Success Response (200):**
```json
{
  "success": true,
  "credits": 10,
  "newBalance": 110,
  "isTestPurchase": false,
  "message": "10 credits added successfully"
}
```

### **Error Responses:**

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Unauthorized - No token provided"
}
```

**400 Bad Request - Invalid Product:**
```json
{
  "success": false,
  "error": "Invalid product ID",
  "details": "Product \"com.chitra.credits_999\" not found in pricing catalog"
}
```

**400 Bad Request - Duplicate Transaction:**
```json
{
  "success": false,
  "error": "Receipt already used",
  "details": "This transaction has already been processed"
}
```

**400 Bad Request - Invalid Receipt:**
```json
{
  "success": false,
  "error": "Invalid receipt",
  "details": "Receipt verification failed with the store"
}
```

---

## ✅ **Implementation Checklist**

- [ ] Add `in_app_purchase` and `http` packages to `pubspec.yaml`
- [ ] Create `IAPManager` class with purchase stream listener
- [ ] Implement `_verifyPurchaseWithBackend()` function
- [ ] Call verification endpoint **AFTER** purchase succeeds
- [ ] Implement `_getUserToken()` to get JWT from your auth system
- [ ] Pass correct `productId` (must match `PRODUCT_CREDITS_MAP`)
- [ ] Send user's JWT token in `Authorization` header
- [ ] Send receipt from `purchaseDetails.verificationData.serverVerificationData`
- [ ] Set `platform: "ios"` or `"android"` based on `Platform.isIOS`
- [ ] Set `isTestMode: false` for production, `true` for iOS testing only
- [ ] Only complete purchase **AFTER** backend confirms success
- [ ] Update UI with new credit balance from response
- [ ] Handle errors (show user appropriate messages)
- [ ] Initialize `IAPManager` in `main.dart`

---

## 🔍 **Debugging**

### **Check Vercel Logs:**
After purchase, check if the backend received the request:
- Go to Vercel Dashboard → Your Project → Logs
- Filter by `/api/pricing/verify-purchase`
- Look for log messages starting with `🔐 PRODUCTION:` or `🧪 TEST MODE:`

### **Common Issues:**

1. **No request reaching backend:**
   - Flutter app is not calling the verification endpoint
   - Check Flutter console logs for `📤 Sending verification request`
   - Verify `_verifyPurchaseWithBackend()` is being called

2. **401 Unauthorized:**
   - JWT token is missing or invalid
   - Check `_getUserToken()` implementation
   - Verify `Authorization: Bearer <token>` header is set

3. **Invalid product ID:**
   - Product ID doesn't match `PRODUCT_CREDITS_MAP`
   - iOS: Check App Store Connect product IDs (e.g., `com.chitra.credits_10`)
   - Android: Check Google Play Console product IDs (e.g., `credits_10`)

4. **Invalid receipt:**
   - Receipt is empty or null
   - Check `purchaseDetails.verificationData.serverVerificationData` is not null
   - For iOS: Ensure app has a valid receipt (test on device, not simulator)

5. **Purchase not completing:**
   - `completePurchase()` called before backend verification
   - Only call `_iap.completePurchase()` AFTER successful backend response

6. **`_getUserToken()` returns null:**
   - You must implement this function to return your user's JWT token
   - Example: `return await FirebaseAuth.instance.currentUser?.getIdToken();`

---

## 🆘 **Next Steps**

1. **Add dependencies** to `pubspec.yaml` (`in_app_purchase`, `http`)
2. **Copy the `IAPManager` class** to your Flutter project
3. **Implement `_getUserToken()`** to return your user's JWT token
4. **Implement `_updateCreditsUI()`** to update your app's UI
5. **Initialize `IAPManager()`** in your `main.dart`
6. **Test on iOS** with StoreKit Configuration (set `isTestMode: true`)
7. **Test on Android** with Google Play Console test users
8. **Verify in Vercel logs** that requests are received
9. **Test with real sandbox purchases** (App Store Sandbox / Google Play testing track)
10. **Submit for production** when everything works on both platforms

---

## 📞 **Backend Endpoint Summary**

```
POST /api/pricing/verify-purchase

Headers:
  Authorization: Bearer <JWT_TOKEN>
  Content-Type: application/json

Body:
{
  "transactionId": "string",
  "productId": "string",
  "receipt": "base64_string",
  "platform": "ios",
  "isTestMode": boolean
}

Response (200):
{
  "success": true,
  "credits": number,
  "newBalance": number,
  "isTestPurchase": boolean,
  "message": "string"
}
```

**Backend is ready and deployed! The iOS app just needs to call this endpoint after purchase.**
