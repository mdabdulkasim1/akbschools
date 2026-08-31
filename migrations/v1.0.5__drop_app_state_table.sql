-- Migration: v1.0.5__drop_app_state_table.sql
-- Version: 1.0.5
-- Description: Drops legacy app_state table as all application state is fully normalized across dedicated tables

DROP TABLE IF EXISTS app_state;
