# 🛡️ Flutter: Prevent Multiple IAP Verification Requests

## 🚨 **The Problem**

Your Flutter app is sending **multiple verification requests** for the same purchase, causing credits to be added multiple times:

```
User clicks "Buy 10 Credits"
  ↓
StoreKit processes purchase
  ↓
Flutter listens to purchase stream
  ↓
App sends verification to backend... ❌
App sends verification to backend... ❌ DUPLICATE
App sends verification to backend... ❌ DUPLICATE
  ↓
Backend adds 10 + 10 + 10 = 30 credits (WRONG!)
```

### **Why This Happens:**

1. **Purchase Stream Fires Multiple Times**: `purchaseStream.listen()` can emit the same purchase multiple times
2. **No Request Debouncing**: App doesn't track ongoing verification requests
3. **StoreKit Polling Bug**: Rapid `restorePurchases()` calls generate new transaction IDs
4. **Network Retries**: Failed requests retry without checking if previous request succeeded

---

## ✅ **Solution: 3-Layer Flutter Protection**

### **Layer 1: Track Pending Verifications (In-Memory)**

Prevent sending multiple requests for the same transaction:

```dart
class IAPManager {
  // Track ongoing verification requests
  final Set<String> _pendingVerifications = {};
  
  // Track completed transactions
  final Set<String> _completedTransactions = {};
  
  Future<void> _verifyPurchase(PurchaseDetails purchase) async {
    final transactionId = purchase.purchaseID ?? '';
    
    // ============================================
    // CHECK 1: Already completed?
    // ============================================
    if (_completedTransactions.contains(transactionId)) {
      print('⚠️ Transaction already completed: $transactionId');
      await _iap.completePurchase(purchase);
      return;
    }
    
    // ============================================
    // CHECK 2: Already verifying?
    // ============================================
    if (_pendingVerifications.contains(transactionId)) {
      print('⚠️ Transaction already being verified: $transactionId');
      return; // Don't send duplicate request
    }
    
    // ============================================
    // VERIFY: Mark as pending and send request
    // ============================================
    _pendingVerifications.add(transactionId);
    
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/pricing/verify-purchase'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'transactionId': transactionId,
          'productId': purchase.productID,
          'receipt': purchase.verificationData.serverVerificationData,
          'platform': Platform.isIOS ? 'ios' : 'android',
        }),
      );
      
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        
        if (data['success'] == true) {
          // Mark as completed
          _completedTransactions.add(transactionId);
          
          // Complete the purchase with store
          await _iap.completePurchase(purchase);
          
          print('✅ Purchase verified: ${data['credits']} credits added');
          print('💰 New balance: ${data['newBalance']}');
        }
      }
    } catch (e) {
      print('❌ Verification error: $e');
    } finally {
      // Remove from pending (allow retry on failure)
      _pendingVerifications.remove(transactionId);
    }
  }
}
```

---

### **Layer 2: Persistent Transaction Tracking (SharedPreferences)**

Prevent duplicate verifications across app restarts:

```dart
import 'package:shared_preferences/shared_preferences.dart';

class IAPManager {
  static const String _completedTransactionsKey = 'completed_transactions';
  
  // Load completed transactions on init
  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    final completedList = prefs.getStringList(_completedTransactionsKey) ?? [];
    _completedTransactions.addAll(completedList);
    
    print('📦 Loaded ${_completedTransactions.length} completed transactions');
  }
  
  // Save completed transaction
  Future<void> _markTransactionCompleted(String transactionId) async {
    _completedTransactions.add(transactionId);
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _completedTransactionsKey,
      _completedTransactions.toList(),
    );
    
    print('💾 Saved completed transaction: $transactionId');
  }
  
  // Cleanup old transactions (keep last 100)
  Future<void> _cleanupOldTransactions() async {
    if (_completedTransactions.length > 100) {
      final toKeep = _completedTransactions.toList()..removeRange(0, 50);
      _completedTransactions.clear();
      _completedTransactions.addAll(toKeep);
      
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_completedTransactionsKey, toKeep);
    }
  }
  
  Future<void> _verifyPurchase(PurchaseDetails purchase) async {
    final transactionId = purchase.purchaseID ?? '';
    
    // CHECK: Already completed? (from SharedPreferences)
    if (_completedTransactions.contains(transactionId)) {
      print('⚠️ Transaction already completed (from storage): $transactionId');
      await _iap.completePurchase(purchase);
      return;
    }
    
    // ... rest of verification logic
    
    if (success) {
      await _markTransactionCompleted(transactionId);
      await _cleanupOldTransactions();
    }
  }
}
```

---

### **Layer 3: Debounce Purchase Stream**

Prevent rapid duplicate events:

```dart
import 'dart:async';

class IAPManager {
  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;
  Timer? _debounceTimer;
  
  // Map to track last processing time per transaction
  final Map<String, DateTime> _lastProcessedTime = {};
  
  void _listenToPurchaseUpdates() {
    _purchaseSubscription = _iap.purchaseStream.listen(
      (purchases) {
        _debounceTimer?.cancel();
        
        // Wait 500ms before processing (debounce rapid events)
        _debounceTimer = Timer(Duration(milliseconds: 500), () {
          _processPurchases(purchases);
        });
      },
      onError: (error) {
        print('❌ Purchase stream error: $error');
      },
    );
  }
  
  Future<void> _processPurchases(List<PurchaseDetails> purchases) async {
    for (var purchase in purchases) {
      final transactionId = purchase.purchaseID ?? '';
      
      // ============================================
      // TIME-BASED CHECK: Processed recently?
      // ============================================
      if (_lastProcessedTime.containsKey(transactionId)) {
        final timeSinceProcessed = DateTime.now().difference(
          _lastProcessedTime[transactionId]!
        );
        
        if (timeSinceProcessed.inSeconds < 10) {
          print('⚠️ Transaction processed ${timeSinceProcessed.inSeconds}s ago, skipping');
          continue;
        }
      }
      
      // Mark processing time
      _lastProcessedTime[transactionId] = DateTime.now();
      
      // Process purchase
      if (purchase.status == PurchaseStatus.purchased) {
        await _verifyPurchase(purchase);
      } else if (purchase.status == PurchaseStatus.error) {
        await _iap.completePurchase(purchase);
      }
      
      // Cleanup old timestamps (keep last 50)
      if (_lastProcessedTime.length > 50) {
        final oldestKeys = _lastProcessedTime.keys.take(25).toList();
        oldestKeys.forEach(_lastProcessedTime.remove);
      }
    }
  }
  
  @override
  void dispose() {
    _debounceTimer?.cancel();
    _purchaseSubscription?.cancel();
    super.dispose();
  }
}
```

---

## 🔧 **Complete IAPManager Implementation**

Here's the full implementation with all 3 layers:

```dart
import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;

class IAPManager extends ChangeNotifier {
  final InAppPurchase _iap = InAppPurchase.instance;
  
  // Layer 1: In-memory tracking
  final Set<String> _pendingVerifications = {};
  final Set<String> _completedTransactions = {};
  
  // Layer 2: Persistent storage key
  static const String _completedTransactionsKey = 'completed_transactions';
  
  // Layer 3: Debouncing
  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;
  Timer? _debounceTimer;
  final Map<String, DateTime> _lastProcessedTime = {};
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  Future<void> init() async {
    // Load completed transactions from storage
    final prefs = await SharedPreferences.getInstance();
    final completedList = prefs.getStringList(_completedTransactionsKey) ?? [];
    _completedTransactions.addAll(completedList);
    
    print('🛡️ IAP Protection initialized: ${_completedTransactions.length} completed transactions loaded');
    
    // Listen to purchase stream
    _listenToPurchaseUpdates();
  }
  
  // ============================================
  // PURCHASE STREAM LISTENER (with debouncing)
  // ============================================
  
  void _listenToPurchaseUpdates() {
    _purchaseSubscription = _iap.purchaseStream.listen(
      (purchases) {
        _debounceTimer?.cancel();
        
        // Debounce: Wait 500ms before processing
        _debounceTimer = Timer(Duration(milliseconds: 500), () {
          _processPurchases(purchases);
        });
      },
      onError: (error) {
        print('❌ Purchase stream error: $error');
      },
    );
  }
  
  // ============================================
  // PROCESS PURCHASES (with time-based check)
  // ============================================
  
  Future<void> _processPurchases(List<PurchaseDetails> purchases) async {
    for (var purchase in purchases) {
      final transactionId = purchase.purchaseID ?? '';
      
      if (transactionId.isEmpty) {
        print('⚠️ Empty transaction ID, skipping');
        continue;
      }
      
      // TIME-BASED CHECK: Processed recently?
      if (_lastProcessedTime.containsKey(transactionId)) {
        final timeSinceProcessed = DateTime.now().difference(
          _lastProcessedTime[transactionId]!
        );
        
        if (timeSinceProcessed.inSeconds < 10) {
          print('⚠️ Transaction $transactionId processed ${timeSinceProcessed.inSeconds}s ago, skipping');
          continue;
        }
      }
      
      // Mark processing time
      _lastProcessedTime[transactionId] = DateTime.now();
      
      // Handle purchase status
      if (purchase.status == PurchaseStatus.purchased) {
        await _verifyPurchase(purchase);
      } else if (purchase.status == PurchaseStatus.restored) {
        await _verifyPurchase(purchase);
      } else if (purchase.status == PurchaseStatus.error) {
        await _iap.completePurchase(purchase);
      }
      
      // Cleanup old timestamps
      if (_lastProcessedTime.length > 50) {
        final oldestKeys = _lastProcessedTime.keys.take(25).toList();
        oldestKeys.forEach(_lastProcessedTime.remove);
      }
    }
  }
  
  // ============================================
  // VERIFY PURCHASE (with duplicate prevention)
  // ============================================
  
  Future<void> _verifyPurchase(PurchaseDetails purchase) async {
    final transactionId = purchase.purchaseID ?? '';
    final productId = purchase.productID;
    
    print('🔍 Verifying purchase: $transactionId ($productId)');
    
    // ============================================
    // CHECK 1: Already completed?
    // ============================================
    if (_completedTransactions.contains(transactionId)) {
      print('⚠️ Transaction already completed: $transactionId');
      await _iap.completePurchase(purchase);
      return;
    }
    
    // ============================================
    // CHECK 2: Already verifying?
    // ============================================
    if (_pendingVerifications.contains(transactionId)) {
      print('⚠️ Transaction already being verified: $transactionId');
      return;
    }
    
    // ============================================
    // VERIFY: Send request to backend
    // ============================================
    _pendingVerifications.add(transactionId);
    
    try {
      final token = await _getAuthToken(); // Your auth token logic
      final baseUrl = 'YOUR_BACKEND_URL'; // Your backend URL
      
      final response = await http.post(
        Uri.parse('$baseUrl/api/pricing/verify-purchase'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'transactionId': transactionId,
          'productId': productId,
          'receipt': purchase.verificationData.serverVerificationData,
          'platform': Platform.isIOS ? 'ios' : 'android',
        }),
      ).timeout(Duration(seconds: 30));
      
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        
        if (data['success'] == true) {
          print('✅ Purchase verified successfully');
          print('💰 Credits added: ${data['credits']}');
          print('💰 New balance: ${data['newBalance']}');
          
          // Check if this was a duplicate on backend
          if (data['message']?.contains('already') == true) {
            print('ℹ️ Backend note: ${data['message']}');
          }
          
          // Mark as completed
          await _markTransactionCompleted(transactionId);
          
          // Complete purchase with store
          await _iap.completePurchase(purchase);
          
          // Notify listeners
          notifyListeners();
        } else {
          print('❌ Verification failed: ${data['error']}');
          // Don't mark as completed - allow retry
        }
      } else {
        print('❌ Backend error: ${response.statusCode}');
        // Don't mark as completed - allow retry
      }
    } catch (e) {
      print('❌ Verification exception: $e');
      // Don't mark as completed - allow retry
    } finally {
      // Remove from pending
      _pendingVerifications.remove(transactionId);
    }
  }
  
  // ============================================
  // PERSISTENT STORAGE
  // ============================================
  
  Future<void> _markTransactionCompleted(String transactionId) async {
    _completedTransactions.add(transactionId);
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _completedTransactionsKey,
      _completedTransactions.toList(),
    );
    
    print('💾 Saved completed transaction: $transactionId');
    
    // Cleanup old transactions
    await _cleanupOldTransactions();
  }
  
  Future<void> _cleanupOldTransactions() async {
    if (_completedTransactions.length > 100) {
      final toKeep = _completedTransactions.toList()..removeRange(0, 50);
      _completedTransactions.clear();
      _completedTransactions.addAll(toKeep);
      
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(_completedTransactionsKey, toKeep);
      
      print('🧹 Cleaned up old transactions, kept ${toKeep.length}');
    }
  }
  
  // ============================================
  // HELPERS
  // ============================================
  
  Future<String> _getAuthToken() async {
    // Your token retrieval logic
    // Example: FirebaseAuth.instance.currentUser?.getIdToken()
    throw UnimplementedError('Implement your auth token logic');
  }
  
  // ============================================
  // CLEANUP
  // ============================================
  
  @override
  void dispose() {
    _debounceTimer?.cancel();
    _purchaseSubscription?.cancel();
    super.dispose();
  }
}
```

---

## 📦 **Required Dependencies**

Add to `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  in_app_purchase: ^3.1.11
  shared_preferences: ^2.2.2
  http: ^1.1.0
```

---

## 🎯 **How It Works**

### **Scenario: User purchases 10 credits, app sends 3 requests**

```
┌─────────────────────────────────────────────────────────────┐
│ Request 1 (First)                                            │
│ ├─ Check completed transactions: NOT FOUND ✓                │
│ ├─ Check pending verifications: NOT FOUND ✓                 │
│ ├─ Add to pending ✓                                         │
│ ├─ Send to backend ✓                                        │
│ ├─ Backend adds 10 credits ✓                                │
│ ├─ Mark as completed ✓                                      │
│ └─ Save to SharedPreferences ✓                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Request 2 (300ms later)                                      │
│ ├─ Check completed transactions: FOUND! ⚠️                  │
│ └─ Skip verification ✓                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Request 3 (500ms later, debounced)                           │
│ ├─ Check completed transactions: FOUND! ⚠️                  │
│ └─ Skip verification ✓                                      │
└─────────────────────────────────────────────────────────────┘

Result: ✅ Only 1 request sent to backend
        ✅ User gets 10 credits (correct!)
```

---

## 🧪 **Testing**

### **Test 1: Normal Purchase**

```dart
// Make a purchase
await IAPManager.instance.buyProduct('credits_10');

// Expected logs:
// 🔍 Verifying purchase: 2000000875510556 (credits_10)
// ✅ Purchase verified successfully
// 💰 Credits added: 10
// 💾 Saved completed transaction: 2000000875510556
```

### **Test 2: Duplicate Prevention**

```dart
// Trigger purchase stream multiple times (simulate bug)
_processPurchases([purchaseDetails]);
await Future.delayed(Duration(milliseconds: 100));
_processPurchases([purchaseDetails]); // Duplicate

// Expected logs:
// 🔍 Verifying purchase: 2000000875510556 (credits_10)
// ⚠️ Transaction already being verified: 2000000875510556  ← BLOCKED
// ✅ Purchase verified successfully
// 💾 Saved completed transaction: 2000000875510556
```

### **Test 3: App Restart**

```dart
// Restart app
await IAPManager.instance.init();

// Call restorePurchases (triggers purchase stream)
await _iap.restorePurchases();

// Expected logs:
// 🛡️ IAP Protection initialized: 5 completed transactions loaded
// ⚠️ Transaction already completed: 2000000875510556  ← BLOCKED
```

---

## ✅ **Checklist**

Flutter-side duplicate prevention is complete when:

- [x] In-memory tracking (`_pendingVerifications`, `_completedTransactions`)
- [x] Persistent storage (`SharedPreferences`)
- [x] Debounced purchase stream (500ms delay)
- [x] Time-based duplicate check (10 seconds)
- [x] Proper cleanup (limit storage to 100 transactions)
- [x] Backend duplicate handling (time-based check on server)

---

## 🎉 **Result**

With both **Flutter-side** and **Backend-side** protection:

- ✅ **Flutter** prevents sending duplicate requests
- ✅ **Backend** prevents processing duplicates (if any slip through)
- ✅ User gets exactly the credits they paid for
- ✅ No accounting errors
- ✅ Better app performance (fewer unnecessary requests)

---

## 📚 **Related Documentation**

- See `DUPLICATE_PURCHASE_PREVENTION.md` for backend implementation
- See `FLUTTER_IAP_INTEGRATION_GUIDE.md` for complete IAP setup
