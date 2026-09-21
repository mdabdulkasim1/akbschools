-- Migration v1.0.10: Add report_json column to report_cards table
ALTER TABLE report_cards ADD COLUMN report_json LONGTEXT;
