-- 📱 Mobile number + OTP login for customers. Re-runnable. Runs after auth.sql.
-- Our server makes the 6-digit code (only its hash is stored here); an SMS company (2Factor) only delivers it.
-- Limits protect the SMS credit from misuse ("SMS pumping"): 30 s between codes and 5 an hour per number,
-- 20 an hour per IP address, and a daily cap for the whole app (site setting sms_daily_cap, default 500).

CREATE TABLE IF NOT EXISTS phone_otps (
  id           BIGSERIAL PRIMARY KEY,
  phone        CHAR(10)    NOT NULL,           -- Indian mobile number without +91
  code_hash    CHAR(64)    NOT NULL,           -- sha256 hex of (phone, code, server secret)
  attempts     INT         NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 5,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  request_ip   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_otps_lookup_idx ON phone_otps (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_otps_ip_idx ON phone_otps (request_ip, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_otps_created_idx ON phone_otps (created_at);

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Asks for a new code for p_phone. Any earlier unused code for the number stops working.
CREATE OR REPLACE FUNCTION fn_phone_otp_request(p_phone TEXT, p_code_hash TEXT, p_ip TEXT, p_ttl_minutes INT DEFAULT 10)
RETURNS BIGINT
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_last TIMESTAMPTZ;
  v_id   BIGINT;
BEGIN
  IF coalesce(p_phone, '') !~ '^[6-9]\d{9}$' THEN
    RAISE EXCEPTION 'Enter a valid 10-digit mobile number' USING ERRCODE = '22023';
  END IF;
  SELECT max(created_at) INTO v_last FROM phone_otps WHERE phone = p_phone;
  IF v_last > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'Please wait % seconds before asking for another OTP',
      ceil(30 - extract(epoch FROM now() - v_last))::int USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM phone_otps WHERE phone = p_phone AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many OTPs for this number. Please try again in an hour.' USING ERRCODE = '55000';
  END IF;
  IF p_ip IS NOT NULL AND (SELECT count(*) FROM phone_otps WHERE request_ip = p_ip AND created_at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Too many requests. Please try again later.' USING ERRCODE = '55000';
  END IF;
  IF (SELECT count(*) FROM phone_otps WHERE created_at > now() - interval '1 day') >= fn_setting_num('sms_daily_cap', 500) THEN
    RAISE EXCEPTION 'Mobile OTP is busy right now. Please log in with email or password, or try later.' USING ERRCODE = '55000';
  END IF;

  UPDATE phone_otps SET consumed_at = now() WHERE phone = p_phone AND consumed_at IS NULL;
  INSERT INTO phone_otps (phone, code_hash, expires_at, request_ip)
  VALUES (p_phone, p_code_hash, now() + make_interval(mins => p_ttl_minutes), p_ip)
  RETURNING id INTO v_id;
  CALL sp_auth_log(NULL, NULL, 'otp_requested', 'mobile ' || left(p_phone, 2) || '******' || right(p_phone, 2), p_ip);
  RETURN v_id;
END $$;

-- The SMS could not be sent: that code must not count against the customer's next try.
CREATE OR REPLACE PROCEDURE sp_phone_otp_failed(p_id BIGINT)
LANGUAGE sql SET search_path FROM CURRENT AS $$
  DELETE FROM phone_otps WHERE id = p_id
$$;

-- Checks a code: 'ok' | 'wrong' (attempts_left) | 'locked' | 'expired' | 'no_code'.
-- Returns a status instead of raising, so the wrong-code count is kept.
CREATE OR REPLACE FUNCTION fn_phone_otp_check(p_phone TEXT, p_code_hash TEXT, p_ip TEXT)
RETURNS TABLE (status TEXT, attempts_left INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  o phone_otps;
BEGIN
  SELECT * INTO o FROM phone_otps WHERE phone = p_phone AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_code'::text, 0;
    RETURN;
  END IF;
  IF o.expires_at < now() THEN
    UPDATE phone_otps SET consumed_at = now() WHERE id = o.id;
    RETURN QUERY SELECT 'expired'::text, 0;
    RETURN;
  END IF;
  IF o.attempts >= o.max_attempts THEN
    RETURN QUERY SELECT 'locked'::text, 0;
    RETURN;
  END IF;
  IF o.code_hash <> p_code_hash THEN
    UPDATE phone_otps SET attempts = attempts + 1 WHERE id = o.id;
    CALL sp_auth_log(NULL, NULL, 'otp_failed', 'mobile: wrong code', p_ip);
    RETURN QUERY SELECT CASE WHEN o.attempts + 1 >= o.max_attempts THEN 'locked' ELSE 'wrong' END, o.max_attempts - o.attempts - 1;
    RETURN;
  END IF;
  UPDATE phone_otps SET consumed_at = now(), attempts = attempts + 1 WHERE id = o.id;
  RETURN QUERY SELECT 'ok'::text, o.max_attempts - o.attempts - 1;
END $$;
