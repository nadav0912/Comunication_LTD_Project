-- Comunication_LTD schema.
-- Applied by scripts/init-db.js, which adds IF NOT EXISTS at runtime for idempotent re-runs
-- (this file stays the spec's canonical DDL). password_history.salt is deliberate:
-- one row per password, salt rotated on every change, so history verification is per row.

CREATE TABLE users (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  username              VARCHAR(50)  NOT NULL UNIQUE,
  email                 VARCHAR(255) NOT NULL,
  password_hash         CHAR(64)     NOT NULL,          -- HMAC-SHA256 hex
  salt                  CHAR(32)     NOT NULL,          -- 16 random bytes, hex
  failed_login_attempts INT          NOT NULL DEFAULT 0,
  is_locked             TINYINT(1)   NOT NULL DEFAULT 0,
  reset_token           CHAR(40)     NULL,              -- SHA-1 hex
  reset_token_expires   DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE password_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT      NOT NULL,
  password_hash CHAR(64) NOT NULL,                       -- HMAC-SHA256 hex
  salt          CHAR(32) NOT NULL,                       -- the salt THIS hash was computed with
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ph_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ph_user_created (user_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,        -- the Stored XSS carrier
  email      VARCHAR(255) NULL,
  phone      VARCHAR(30)  NULL,
  sector     VARCHAR(50)  NULL,
  package    VARCHAR(50)  NULL,
  created_by INT          NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
