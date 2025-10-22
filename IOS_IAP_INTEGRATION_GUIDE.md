# iOS In-App Purchase Integration Guide

## 🚨 **ISSUE: Purchase Successful but Credits Not Added**

The iOS app completed the StoreKit purchase successfully, but the backend didn't receive the verification request. This means **the app is not calling the backend API after the purchase completes**.

---

## 📱 **Required iOS Implementation**

### **Step 1: After StoreKit Purchase Completes**

When the StoreKit purchase transaction finishes successfully, you **MUST** call the backend verification endpoint:

```swift
import StoreKit

func handlePurchaseSuccess(transaction: SKPaymentTransaction) {
    // 1. Get the receipt from the app bundle
    guard let receiptURL = Bundle.main.appStoreReceiptURL,
          let receiptData = try? Data(contentsOf: receiptURL) else {
        print("❌ Failed to load receipt")
        return
    }
    
    // 2. Convert receipt to base64 string
    let receiptString = receiptData.base64EncodedString()
    
    // 3. Get the transaction ID
    let transactionId = transaction.transactionIdentifier ?? "unknown"
    
    // 4. Get the product ID
    let productId = transaction.payment.productIdentifier
    
    // 5. Call backend verification
    verifyPurchaseWithBackend(
        transactionId: transactionId,
        productId: productId,
        receiptString: receiptString
    )
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
- `transactionId`: Get from `transaction.transactionIdentifier`
- `productId`: Must match one of the product IDs defined in the backend (see below)
- `receipt`: Base64-encoded App Store receipt from app bundle
- `platform`: Always `"ios"` for iOS
- `isTestMode`: Set to `true` ONLY for testing with StoreKit Configuration files. Set to `false` for real App Store purchases.

---

### **Step 3: Full Swift Implementation Example**

```swift
import Foundation
import StoreKit

class IAPManager: NSObject, SKPaymentTransactionObserver {
    
    static let shared = IAPManager()
    
    private override init() {
        super.init()
        SKPaymentQueue.default().add(self)
    }
    
    // MARK: - StoreKit Transaction Observer
    
    func paymentQueue(_ queue: SKPaymentQueue, updatedTransactions transactions: [SKPaymentTransaction]) {
        for transaction in transactions {
            switch transaction.transactionState {
            case .purchased:
                handlePurchased(transaction)
            case .failed:
                handleFailed(transaction)
            case .restored:
                handleRestored(transaction)
            case .deferred, .purchasing:
                break
            @unknown default:
                break
            }
        }
    }
    
    private func handlePurchased(_ transaction: SKPaymentTransaction) {
        print("✅ Purchase successful: \(transaction.payment.productIdentifier)")
        
        // ⚠️ CRITICAL: Verify with backend BEFORE finishing transaction
        verifyPurchaseWithBackend(transaction: transaction) { success in
            if success {
                // Only finish transaction after backend confirms
                SKPaymentQueue.default().finishTransaction(transaction)
                print("✅ Transaction finished")
            } else {
                print("❌ Backend verification failed, will retry later")
                // Don't finish transaction - it will retry on next app launch
            }
        }
    }
    
    private func handleFailed(_ transaction: SKPaymentTransaction) {
        print("❌ Purchase failed: \(transaction.error?.localizedDescription ?? "Unknown error")")
        SKPaymentQueue.default().finishTransaction(transaction)
    }
    
    private func handleRestored(_ transaction: SKPaymentTransaction) {
        print("🔄 Transaction restored: \(transaction.payment.productIdentifier)")
        SKPaymentQueue.default().finishTransaction(transaction)
    }
    
    // MARK: - Backend Verification
    
    private func verifyPurchaseWithBackend(
        transaction: SKPaymentTransaction,
        completion: @escaping (Bool) -> Void
    ) {
        // 1. Get receipt
        guard let receiptURL = Bundle.main.appStoreReceiptURL,
              let receiptData = try? Data(contentsOf: receiptURL) else {
            print("❌ No receipt found")
            completion(false)
            return
        }
        
        let receiptString = receiptData.base64EncodedString()
        
        // 2. Get transaction details
        let transactionId = transaction.transactionIdentifier ?? "unknown_\(Date().timeIntervalSince1970)"
        let productId = transaction.payment.productIdentifier
        
        // 3. Get user token (from your auth system)
        guard let userToken = UserDefaults.standard.string(forKey: "userToken") else {
            print("❌ No user token found")
            completion(false)
            return
        }
        
        // 4. Prepare request
        guard let url = URL(string: "https://your-backend-domain.vercel.app/api/pricing/verify-purchase") else {
            completion(false)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(userToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let requestBody: [String: Any] = [
            "transactionId": transactionId,
            "productId": productId,
            "receipt": receiptString,
            "platform": "ios",
            "isTestMode": false  // Set to true ONLY for StoreKit testing
        ]
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: requestBody) else {
            completion(false)
            return
        }
        
        request.httpBody = jsonData
        
        // 5. Send request
        print("📤 Sending verification request for \(productId)")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                print("❌ Network error: \(error.localizedDescription)")
                completion(false)
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse else {
                print("❌ Invalid response")
                completion(false)
                return
            }
            
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("❌ Invalid JSON response")
                completion(false)
                return
            }
            
            print("📥 Backend response: \(json)")
            
            if httpResponse.statusCode == 200, let success = json["success"] as? Bool, success {
                let credits = json["credits"] as? Int ?? 0
                let newBalance = json["newBalance"] as? Int ?? 0
                let message = json["message"] as? String ?? "Credits added"
                
                print("✅ \(message)")
                print("✅ Credits added: \(credits)")
                print("✅ New balance: \(newBalance)")
                
                // Update UI
                DispatchQueue.main.async {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("CreditsUpdated"),
                        object: nil,
                        userInfo: ["newBalance": newBalance, "creditsAdded": credits]
                    )
                }
                
                completion(true)
            } else {
                let errorMessage = json["error"] as? String ?? "Unknown error"
                let details = json["details"] as? String ?? ""
                print("❌ Backend verification failed: \(errorMessage)")
                if !details.isEmpty {
                    print("   Details: \(details)")
                }
                completion(false)
            }
        }.resume()
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

## 🧪 **Testing with StoreKit**

For testing with StoreKit Configuration file:

1. Set `isTestMode: true` in the request
2. Ensure `ALLOW_TEST_PURCHASES=true` in backend environment variables
3. Use test transactions - they will be marked as test in the database

**Example for testing:**
```swift
let requestBody: [String: Any] = [
    "transactionId": transactionId,
    "productId": productId,
    "receipt": receiptString,
    "platform": "ios",
    "isTestMode": true  // ✅ Enable for StoreKit testing
]
```

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

- [ ] Add `verifyPurchaseWithBackend()` function to your IAP manager
- [ ] Call verification endpoint **AFTER** StoreKit purchase succeeds
- [ ] Pass correct `productId` (must match `PRODUCT_CREDITS_MAP`)
- [ ] Send user's JWT token in `Authorization` header
- [ ] Send base64-encoded App Store receipt
- [ ] Set `platform: "ios"`
- [ ] Set `isTestMode: false` for production, `true` for StoreKit testing
- [ ] Only finish transaction **AFTER** backend confirms success
- [ ] Update UI with new credit balance from response
- [ ] Handle errors (show user appropriate messages)

---

## 🔍 **Debugging**

### **Check Vercel Logs:**
After purchase, check if the backend received the request:
- Go to Vercel Dashboard → Your Project → Logs
- Filter by `/api/pricing/verify-purchase`
- Look for log messages starting with `🔐 PRODUCTION:` or `🧪 TEST MODE:`

### **Common Issues:**

1. **No request reaching backend:**
   - iOS app is not calling the verification endpoint
   - Check network logs in Xcode console

2. **401 Unauthorized:**
   - JWT token is missing or invalid
   - Check `Authorization: Bearer <token>` header

3. **Invalid product ID:**
   - Product ID doesn't match `PRODUCT_CREDITS_MAP`
   - Check App Store Connect product IDs

4. **Invalid receipt:**
   - Receipt is not properly base64 encoded
   - Receipt URL is nil (refresh receipt first)

---

## 🆘 **Next Steps**

1. **Implement the verification call** in your iOS StoreKit purchase flow
2. **Test with StoreKit Configuration** (set `isTestMode: true`)
3. **Verify in Vercel logs** that requests are received
4. **Test with real App Store Sandbox** (set `isTestMode: false`)
5. **Submit for production** when everything works

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
