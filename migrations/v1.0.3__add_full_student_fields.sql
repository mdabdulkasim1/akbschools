-- Migration: v1.0.3__add_full_student_fields.sql
-- Version: 1.0.3
-- Description: Adds all student fields extracted from workbook (mother, class_teacher, gender, age, prev_school, location, vehicle, religion, admission, etc.)

ALTER TABLE students
    ADD COLUMN IF NOT EXISTS class_teacher VARCHAR(100) DEFAULT NULL AFTER grade,
    ADD COLUMN IF NOT EXISTS gender VARCHAR(20) DEFAULT NULL AFTER class_teacher,
    ADD COLUMN IF NOT EXISTS age VARCHAR(20) DEFAULT NULL AFTER dob,
    ADD COLUMN IF NOT EXISTS prev_school VARCHAR(255) DEFAULT NULL AFTER age,
    ADD COLUMN IF NOT EXISTS mother VARCHAR(255) DEFAULT NULL AFTER father,
    ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT NULL AFTER address,
    ADD COLUMN IF NOT EXISTS drop_location VARCHAR(255) DEFAULT NULL AFTER location,
    ADD COLUMN IF NOT EXISTS transport_type VARCHAR(100) DEFAULT NULL AFTER drop_location,
    ADD COLUMN IF NOT EXISTS vehicle VARCHAR(255) DEFAULT NULL AFTER transport_type,
    ADD COLUMN IF NOT EXISTS religion VARCHAR(100) DEFAULT NULL AFTER contact,
    ADD COLUMN IF NOT EXISTS admission VARCHAR(50) DEFAULT 'NEW' AFTER discount,
    ADD COLUMN IF NOT EXISTS sports_activity VARCHAR(255) DEFAULT NULL AFTER admission,
    ADD COLUMN IF NOT EXISTS photo TEXT DEFAULT NULL AFTER sports_activity;
