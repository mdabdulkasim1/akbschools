-- Add pages_json and grades_json to users table for fine-grained page access and teacher class assignments
ALTER TABLE users ADD COLUMN IF NOT EXISTS pages_json TEXT DEFAULT NULL AFTER role;
ALTER TABLE users ADD COLUMN IF NOT EXISTS grades_json TEXT DEFAULT NULL AFTER pages_json;
