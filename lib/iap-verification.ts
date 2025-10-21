/**
 * In-App Purchase (IAP) Verification Library
 * Supports Apple App Store and Google Play Store receipt verification
 */

import env from './env';
import { AppleVerificationResult, GoogleVerificationResult } from '@/types';

// ============================================
// APPLE RECEIPT VERIFICATION
// ============================================

/**
 * Verify Apple App Store receipt
 * @param receiptData - Base64 encoded receipt data from iOS app
 * @returns Verification result with transaction details
 */
export async function verifyAppleReceipt(receiptData: string): Promise<AppleVerificationResult> {
  // Use sandbox for testing, production for live
  const VERIFY_URL = env.APPLE_ENV === 'production'
    ? 'https://buy.itunes.apple.com/verifyReceipt'
    : 'https://sandbox.itunes.apple.com/verifyReceipt';

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        'password': env.APPLE_SHARED_SECRET,
        'exclude-old-transactions': true
      })
    });

    const result = await response.json();

    // Status codes: https://developer.apple.com/documentation/appstorereceipts/status
    if (result.status === 0) {
      // Valid receipt
      const latestReceipt = result.latest_receipt_info?.[0] || result.receipt?.in_app?.[0];

      if (!latestReceipt) {
        console.log('❌ No receipt info found in Apple response');
        return { isValid: false };
      }

      return {
        isValid: true,
        transactionId: latestReceipt.transaction_id,
        productId: latestReceipt.product_id,
        purchaseDate: latestReceipt.purchase_date_ms,
        isTestPurchase: false
      };

    } else if (result.status === 21007) {
      // Sandbox receipt sent to production - retry with sandbox URL
      console.log('⚠️  Sandbox receipt detected, retrying with sandbox URL');
      return await verifyAppleReceiptSandbox(receiptData);

    } else {
      console.log(`❌ Apple verification failed with status: ${result.status}`);
      return { isValid: false };
    }

  } catch (error) {
    console.error('Apple verification error:', error);
    return { isValid: false };
  }
}

/**
 * Verify Apple receipt using sandbox environment
 * @param receiptData - Base64 encoded receipt data
 * @returns Verification result
 */
async function verifyAppleReceiptSandbox(receiptData: string): Promise<AppleVerificationResult> {
  try {
    const response = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        'password': env.APPLE_SHARED_SECRET,
        'exclude-old-transactions': true
      })
    });

    const result = await response.json();

    if (result.status === 0) {
      const latestReceipt = result.latest_receipt_info?.[0] || result.receipt?.in_app?.[0];

      if (!latestReceipt) {
        console.log('❌ No receipt info found in sandbox response');
        return { isValid: false };
      }

      return {
        isValid: true,
        transactionId: latestReceipt.transaction_id,
        productId: latestReceipt.product_id,
        purchaseDate: latestReceipt.purchase_date_ms,
        isTestPurchase: false
      };
    }

    return { isValid: false };

  } catch (error) {
    console.error('Apple sandbox verification error:', error);
    return { isValid: false };
  }
}

// ============================================
// GOOGLE RECEIPT VERIFICATION
// ============================================

/**
 * Verify Google Play Store receipt
 * @param purchaseToken - Purchase token from Android app
 * @param productId - Product ID being verified
 * @returns Verification result with transaction details
 */
export async function verifyGoogleReceipt(
  purchaseToken: string,
  productId: string
): Promise<GoogleVerificationResult> {
  try {
    // Google requires googleapis package
    const { google } = await import('googleapis');

    if (!env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.error('❌ GOOGLE_SERVICE_ACCOUNT_KEY not configured');
      return { isValid: false };
    }

    // Parse service account key from base64
    let serviceAccountKey;
    try {
      const decoded = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf-8');
      serviceAccountKey = JSON.parse(decoded);
    } catch (parseError) {
      console.error('❌ Failed to parse Google service account key:', parseError);
      return { isValid: false };
    }

    // Create auth client
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountKey,
      scopes: ['https://www.googleapis.com/auth/androidpublisher']
    });

    const androidPublisher = google.androidpublisher({
      version: 'v3',
      auth: auth
    });

    // Verify the purchase
    const response = await androidPublisher.purchases.products.get({
      packageName: env.GOOGLE_PACKAGE_NAME || 'com.ai.headshot.photo.generator',
      productId: productId,
      token: purchaseToken
    });

    const purchase = response.data;

    // Check purchase state
    // 0 = Purchased, 1 = Canceled, 2 = Pending
    if (purchase.purchaseState === 0) {
      return {
        isValid: true,
        transactionId: purchase.orderId || `google_${Date.now()}`,
        productId: productId,
        purchaseDate: purchase.purchaseTimeMillis || undefined,
        isTestPurchase: false
      };
    }

    console.log(`❌ Google purchase state invalid: ${purchase.purchaseState}`);
    return { isValid: false };

  } catch (error: any) {
    console.error('Google verification error:', error);
    
    // Handle specific Google API errors
    if (error.code === 404) {
      console.error('❌ Purchase not found in Google Play');
    } else if (error.code === 401 || error.code === 403) {
      console.error('❌ Google authentication failed - check service account permissions');
    }
    
    return { isValid: false };
  }
}

// ============================================
// TEST MODE VERIFICATION
// ============================================

/**
 * Generate a test verification result for development/testing
 * Only works when ALLOW_TEST_PURCHASES is enabled
 * @param productId - Product ID being tested
 * @returns Mock verification result
 */
export function generateTestVerificationResult(productId: string): AppleVerificationResult | GoogleVerificationResult {
  return {
    isValid: true,
    transactionId: `test_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    productId: productId,
    isTestPurchase: true
  };
}

/**
 * Check if test purchases are allowed
 * @returns True if test mode is enabled
 */
export function isTestModeAllowed(): boolean {
  // Don't allow test purchases in production unless explicitly enabled
  if (process.env.NODE_ENV === 'production' && env.ALLOW_TEST_PURCHASES !== 'true') {
    return false;
  }
  
  return env.ALLOW_TEST_PURCHASES === 'true';
}
