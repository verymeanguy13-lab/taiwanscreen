-- =============================================================================
-- 台股雷達 — Database Schema
-- Run once in the Neon dashboard SQL editor
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. stocks
-- -----------------------------------------------------------------------------
CREATE TABLE stocks (
  symbol          VARCHAR(10)  PRIMARY KEY,
  name_zh         VARCHAR(100) NOT NULL,
  name_en         VARCHAR(100),
  sector          VARCHAR(50),
  market          VARCHAR(10)  NOT NULL,  -- 'TWSE' or 'TPEx'
  listed_date     DATE,
  description_zh  TEXT,
  description_en  TEXT,
  updated_at      TIMESTAMP    DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. daily_prices
-- -----------------------------------------------------------------------------
CREATE TABLE daily_prices (
  symbol      VARCHAR(10)   NOT NULL REFERENCES stocks(symbol),
  date        DATE          NOT NULL,
  open        DECIMAL(10,2),
  high        DECIMAL(10,2),
  low         DECIMAL(10,2),
  close       DECIMAL(10,2),
  volume      BIGINT,                   -- in lots (張)
  change_amt  DECIMAL(8,2),
  change_pct  DECIMAL(6,2),
  PRIMARY KEY (symbol, date)
);

-- -----------------------------------------------------------------------------
-- 3. fundamentals
-- -----------------------------------------------------------------------------
CREATE TABLE fundamentals (
  symbol              VARCHAR(10)  NOT NULL REFERENCES stocks(symbol),
  period              VARCHAR(10)  NOT NULL,  -- e.g. '2024Q3'
  pe_ratio            DECIMAL(8,2),
  pb_ratio            DECIMAL(8,2),
  eps                 DECIMAL(8,2),
  roe                 DECIMAL(6,2),
  roa                 DECIMAL(6,2),
  revenue             BIGINT,
  net_income          BIGINT,
  gross_margin        DECIMAL(6,2),
  net_margin          DECIMAL(6,2),
  revenue_growth_yoy  DECIMAL(6,2),
  eps_growth_yoy      DECIMAL(6,2),
  debt_ratio          DECIMAL(6,2),
  market_cap          BIGINT,
  PRIMARY KEY (symbol, period)
);

-- -----------------------------------------------------------------------------
-- 4. institutional_flows
-- -----------------------------------------------------------------------------
CREATE TABLE institutional_flows (
  symbol                  VARCHAR(10) NOT NULL REFERENCES stocks(symbol),
  date                    DATE        NOT NULL,
  foreign_buy             BIGINT,
  foreign_sell            BIGINT,
  foreign_net             BIGINT,
  trust_buy               BIGINT,
  trust_sell              BIGINT,
  trust_net               BIGINT,
  dealer_buy              BIGINT,
  dealer_sell             BIGINT,
  dealer_net              BIGINT,
  total_net               BIGINT,
  foreign_consecutive_days INT        DEFAULT 0,
  trust_consecutive_days   INT        DEFAULT 0,
  triple_buy               BOOLEAN    DEFAULT FALSE,
  PRIMARY KEY (symbol, date)
);

-- -----------------------------------------------------------------------------
-- 5. broker_branches
-- -----------------------------------------------------------------------------
CREATE TABLE broker_branches (
  broker_id    VARCHAR(10)  PRIMARY KEY,
  broker_name  VARCHAR(100) NOT NULL,
  city         VARCHAR(50)
);

-- -----------------------------------------------------------------------------
-- 6. broker_flows
-- -----------------------------------------------------------------------------
CREATE TABLE broker_flows (
  symbol      VARCHAR(10) NOT NULL REFERENCES stocks(symbol),
  date        DATE        NOT NULL,
  broker_id   VARCHAR(10) NOT NULL REFERENCES broker_branches(broker_id),
  buy_volume  BIGINT,
  sell_volume BIGINT,
  net_volume  BIGINT,
  PRIMARY KEY (symbol, date, broker_id)
);

-- -----------------------------------------------------------------------------
-- 7. margin_data
-- -----------------------------------------------------------------------------
CREATE TABLE margin_data (
  symbol          VARCHAR(10) NOT NULL REFERENCES stocks(symbol),
  date            DATE        NOT NULL,
  margin_balance  BIGINT,
  margin_change   BIGINT,
  short_balance   BIGINT,
  short_change    BIGINT,
  margin_ratio    DECIMAL(6,2),
  PRIMARY KEY (symbol, date)
);

-- -----------------------------------------------------------------------------
-- 8. dividends
-- -----------------------------------------------------------------------------
CREATE TABLE dividends (
  symbol          VARCHAR(10)  NOT NULL REFERENCES stocks(symbol),
  year            INT          NOT NULL,
  period          VARCHAR(20)  NOT NULL,
  cash_dividend   DECIMAL(8,4),
  stock_dividend  DECIMAL(8,4),
  yield_pct       DECIMAL(6,2),
  ex_dividend_date DATE,
  payment_date    DATE,
  PRIMARY KEY (symbol, year, period)
);

-- -----------------------------------------------------------------------------
-- 9. dividend_summary
-- -----------------------------------------------------------------------------
CREATE TABLE dividend_summary (
  symbol              VARCHAR(10) PRIMARY KEY REFERENCES stocks(symbol),
  latest_yield_pct    DECIMAL(6,2),
  consecutive_years   INT,
  dividend_frequency  VARCHAR(20),
  stability_score     INT,
  next_ex_date        DATE,
  last_cash_dividend  DECIMAL(8,4)
);

-- -----------------------------------------------------------------------------
-- 10. etfs
-- -----------------------------------------------------------------------------
CREATE TABLE etfs (
  symbol        VARCHAR(10)  PRIMARY KEY REFERENCES stocks(symbol),
  full_name     VARCHAR(200),
  etf_type      VARCHAR(50),
  expense_ratio DECIMAL(5,4),
  aum           BIGINT,
  dividend_freq VARCHAR(20),
  inception_date DATE,
  description_zh TEXT
);

-- -----------------------------------------------------------------------------
-- 11. supply_chain
-- -----------------------------------------------------------------------------
CREATE TABLE supply_chain (
  id             SERIAL       PRIMARY KEY,
  parent_symbol  VARCHAR(10)  REFERENCES stocks(symbol),
  child_symbol   VARCHAR(10)  REFERENCES stocks(symbol),
  ecosystem      VARCHAR(50),   -- 'tsmc' | 'apple' | 'nvidia' | 'ev'
  relationship   VARCHAR(50),
  category       VARCHAR(100),
  tier           INT,
  UNIQUE (parent_symbol, child_symbol, ecosystem)
);

-- -----------------------------------------------------------------------------
-- 12. strategies
-- -----------------------------------------------------------------------------
CREATE TABLE strategies (
  id            SERIAL        PRIMARY KEY,
  name_zh       VARCHAR(200),
  name_en       VARCHAR(200),
  description_zh TEXT,
  filters       JSONB,
  is_preset     BOOLEAN       DEFAULT FALSE
);

-- -----------------------------------------------------------------------------
-- 13. users
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id          SERIAL       PRIMARY KEY,
  email       VARCHAR(200) UNIQUE NOT NULL,
  name        VARCHAR(100),
  plan        VARCHAR(20)  DEFAULT 'free',
  lang_pref   VARCHAR(5)   DEFAULT 'zh',
  created_at  TIMESTAMP    DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 14. alerts
-- -----------------------------------------------------------------------------
CREATE TABLE alerts (
  id              SERIAL       PRIMARY KEY,
  user_id         INT          REFERENCES users(id),
  symbol          VARCHAR(10)  REFERENCES stocks(symbol),
  alert_type      VARCHAR(50),
  threshold       DECIMAL(10,2),
  is_active       BOOLEAN      DEFAULT TRUE,
  last_triggered  TIMESTAMP,
  created_at      TIMESTAMP    DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 15. ptt_mentions
-- -----------------------------------------------------------------------------
CREATE TABLE ptt_mentions (
  symbol           VARCHAR(10)  NOT NULL REFERENCES stocks(symbol),
  date             DATE         NOT NULL,
  mention_count    INT,
  sentiment_score  DECIMAL(4,2),
  PRIMARY KEY (symbol, date)
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_daily_prices_date
  ON daily_prices (date DESC);

CREATE INDEX idx_institutional_flows_date
  ON institutional_flows (date DESC);

CREATE INDEX idx_institutional_flows_triple_buy
  ON institutional_flows (triple_buy, date DESC);

CREATE INDEX idx_broker_flows_symbol_date
  ON broker_flows (symbol, date DESC);

CREATE INDEX idx_dividend_summary_yield
  ON dividend_summary (latest_yield_pct DESC);

CREATE INDEX idx_supply_chain_ecosystem
  ON supply_chain (ecosystem);
  