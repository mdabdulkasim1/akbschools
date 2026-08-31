-- Migration: v1.0.1__create_app_tables.sql
-- Version: 1.0.1
-- Description: Creates app_state table and relational schema tables for students, payments, users

CREATE TABLE IF NOT EXISTS app_state (
    id INT PRIMARY KEY,
    version INT NOT NULL DEFAULT 0,
    state_json LONGTEXT NOT NULL,
    last_backup_at VARCHAR(100) DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    grade VARCHAR(50),
    father VARCHAR(255),
    contact VARCHAR(50),
    dob VARCHAR(50),
    address TEXT,
    status VARCHAR(50) DEFAULT 'active',
    discount DECIMAL(5,2) DEFAULT 0.00,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
    username VARCHAR(100) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'account',
    name VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
    receipt_no VARCHAR(100) PRIMARY KEY,
    date VARCHAR(20) NOT NULL,
    business_name VARCHAR(255),
    student_id VARCHAR(100),
    student_name VARCHAR(255),
    grade VARCHAR(50),
    mode VARCHAR(50),
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    items_json TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
