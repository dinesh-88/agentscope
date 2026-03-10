CREATE TABLE IF NOT EXISTS model_pricing (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_price DOUBLE PRECISION NOT NULL,
    output_price DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (provider, model)
);

INSERT INTO model_pricing (provider, model, input_price, output_price)
VALUES
    ('openai', 'gpt-4o-mini', 0.00000015, 0.0000006),
    ('openai', 'gpt-4o', 0.0000025, 0.00001),
    ('anthropic', 'claude-3-5-haiku-latest', 0.0000008, 0.000004),
    ('anthropic', 'claude-3-5-sonnet-latest', 0.000003, 0.000015)
ON CONFLICT (provider, model) DO UPDATE
SET input_price = EXCLUDED.input_price,
    output_price = EXCLUDED.output_price;

ALTER TABLE spans
ADD COLUMN IF NOT EXISTS provider TEXT NULL,
ADD COLUMN IF NOT EXISTS model TEXT NULL,
ADD COLUMN IF NOT EXISTS input_tokens BIGINT NULL,
ADD COLUMN IF NOT EXISTS output_tokens BIGINT NULL,
ADD COLUMN IF NOT EXISTS total_tokens BIGINT NULL,
ADD COLUMN IF NOT EXISTS estimated_cost DOUBLE PRECISION NULL;
