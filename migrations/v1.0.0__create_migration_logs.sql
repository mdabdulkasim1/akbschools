-- Migration: v1.0.0__create_migration_logs.sql
-- Version: 1.0.0
-- Description: Creates migration_logs table with version column

CREATE TABLE IF NOT EXISTS migration_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(50) DEFAULT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    execution_time_ms INT DEFAULT 0,
    message TEXT,
    executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
