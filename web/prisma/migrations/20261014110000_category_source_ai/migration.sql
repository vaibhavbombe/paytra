-- Expand: a third source for a transaction's category, set by the AI service
-- for payees no rule recognised. Old code never writes it. Rules may replace
-- an AI category later; a USER choice is still never overwritten.
ALTER TYPE "CategorySource" ADD VALUE 'AI';
