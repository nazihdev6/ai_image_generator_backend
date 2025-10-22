-- Add unique constraint to transaction_id if it doesn't exist
-- This ensures database-level prevention of duplicate transactions

DO $$ 
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'transactions_transaction_id_unique'
    ) THEN
        -- Add unique constraint
        ALTER TABLE transactions 
        ADD CONSTRAINT transactions_transaction_id_unique 
        UNIQUE (transaction_id);
        
        RAISE NOTICE 'Unique constraint added to transactions.transaction_id';
    ELSE
        RAISE NOTICE 'Unique constraint already exists on transactions.transaction_id';
    END IF;
END $$;

-- Verify the constraint
SELECT 
    conname as constraint_name,
    contype as constraint_type,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'transactions'::regclass 
AND conname = 'transactions_transaction_id_unique';
