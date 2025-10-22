/**
 * POST /api/pricing/verify-purchase
 * 
 * Verify In-App Purchase receipts from Apple App Store or Google Play Store
 * and add credits to user accounts
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, transactions, creditHistories } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyToken } from '@/lib/jwt';
import { PRODUCT_CREDITS_MAP } from '@/lib/constants';
import {
  verifyAppleReceipt,
  verifyGoogleReceipt,
  generateTestVerificationResult,
  isTestModeAllowed
} from '@/lib/iap-verification';
import { IAPVerificationRequest, IAPVerificationResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    // ============================================
    // STEP 1: AUTHENTICATE USER
    // ============================================
    
    const token = req.headers.get('authorization')?.split(' ')[1];
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - No token provided' },
        { status: 401 }
      );
    }

    let decoded: any;
    try {
      decoded = verifyToken(token);
      if (!decoded) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized - Invalid token' },
          { status: 401 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid or expired token' },
        { status: 401 }
      );
    }

    const userId = decoded.id;

    // ============================================
    // STEP 2: PARSE AND VALIDATE REQUEST
    // ============================================

    const body: IAPVerificationRequest = await req.json();
    const { transactionId, productId, receipt, platform, isTestMode } = body;

    // Validate required fields
    if (!transactionId || !productId || !receipt || !platform) {
      return NextResponse.json<IAPVerificationResponse>(
        {
          success: false,
          error: 'Missing required fields',
          details: 'transactionId, productId, receipt, and platform are required'
        },
        { status: 400 }
      );
    }

    // Validate platform
    if (platform !== 'ios' && platform !== 'android') {
      return NextResponse.json<IAPVerificationResponse>(
        { success: false, error: 'Invalid platform - must be "ios" or "android"' },
        { status: 400 }
      );
    }

    // ============================================
    // STEP 3: GET CREDITS FOR PRODUCT
    // ============================================

    const credits = PRODUCT_CREDITS_MAP[productId];
    if (!credits) {
      console.log(`❌ Invalid product ID: ${productId}`);
      return NextResponse.json<IAPVerificationResponse>(
        {
          success: false,
          error: 'Invalid product ID',
          details: `Product "${productId}" not found in pricing catalog`
        },
        { status: 400 }
      );
    }

    // ============================================
    // STEP 4: VERIFY RECEIPT
    // ============================================

    let verificationResult;

    if (isTestMode) {
      // TEST MODE: Skip Apple/Google verification
      if (!isTestModeAllowed()) {
        console.log('❌ Test purchases attempted but not allowed');
        return NextResponse.json<IAPVerificationResponse>(
          {
            success: false,
            error: 'Test purchases are not allowed',
            details: 'Test mode is disabled in production environment'
          },
          { status: 403 }
        );
      }

      console.log('🧪 TEST MODE: Accepting purchase without verification');
      verificationResult = generateTestVerificationResult(productId);

    } else {
      // PRODUCTION MODE: Verify with Apple/Google
      console.log(`🔐 PRODUCTION: Verifying ${platform} receipt`);

      if (platform === 'ios') {
        verificationResult = await verifyAppleReceipt(receipt);
      } else if (platform === 'android') {
        verificationResult = await verifyGoogleReceipt(receipt, productId);
      }
    }

    // ============================================
    // STEP 5: CHECK IF VALID
    // ============================================

    if (!verificationResult || !verificationResult.isValid) {
      console.log('❌ Receipt verification failed');
      return NextResponse.json<IAPVerificationResponse>(
        {
          success: false,
          error: 'Invalid receipt',
          details: 'Receipt verification failed with the store'
        },
        { status: 400 }
      );
    }

    // ============================================
    // STEP 6: CHECK FOR DUPLICATES (Skip for test purchases)
    // ============================================

    if (!verificationResult.isTestPurchase) {
      const existingTransaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.transactionId, verificationResult.transactionId!))
        .limit(1);

      if (existingTransaction.length > 0) {
        console.log(`⚠️  Duplicate transaction detected: ${verificationResult.transactionId}`);
        return NextResponse.json<IAPVerificationResponse>(
          {
            success: false,
            error: 'Receipt already used',
            details: 'This transaction has already been processed'
          },
          { status: 400 }
        );
      }
    }

    // ============================================
    // STEP 7: ADD CREDITS TO USER
    // ============================================

    // Get current credits and calculate new balance
    const [currentUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!currentUser) {
      return NextResponse.json<IAPVerificationResponse>(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
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

    // ============================================
    // STEP 8: SAVE TRANSACTION RECORD
    // ============================================

    // Truncate receipt for storage (first 100 chars for reference)
    const truncatedReceipt = receipt.substring(0, 100) + '...';

    await db.insert(transactions).values({
      transactionId: verificationResult.transactionId!,
      userId: userId,
      productId: productId,
      credits: credits,
      platform: platform,
      isTest: verificationResult.isTestPurchase || false,
      receipt: truncatedReceipt,
      verifiedAt: new Date(),
      createdAt: new Date()
    });

    // ============================================
    // STEP 9: ADD CREDIT HISTORY ENTRY
    // ============================================

    await db.insert(creditHistories).values({
      userId: userId,
      amount: credits,
      type: 'CREDIT_PURCHASE',
      createdAt: new Date()
    });

    // ============================================
    // STEP 10: RETURN SUCCESS
    // ============================================

    console.log(`✅ ${credits} credits added to user ${userId} (${platform})`);

    const responseMessage = verificationResult.isTestPurchase
      ? `TEST: ${credits} credits added (StoreKit/Play simulator)`
      : `${credits} credits added successfully`;

    return NextResponse.json<IAPVerificationResponse>(
      {
        success: true,
        credits: credits,
        newBalance: newBalance,
        isTestPurchase: verificationResult.isTestPurchase || false,
        message: responseMessage
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('❌ Purchase verification error:', error);
    
    return NextResponse.json<IAPVerificationResponse>(
      {
        success: false,
        error: 'Verification failed',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
