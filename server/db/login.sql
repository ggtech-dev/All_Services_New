-- 📱 Phone-first login (2026-10-17): customers and agents log in with mobile number + OTP (or a password while
-- SMS approval is pending). Email login is gone. Franchise admins can remove an agent at any time.

-- Accounts made by mobile OTP get a random password nobody knows: has_password = false (column in schema.sql)
-- lets them set one in the Account page without "current password" (they proved the number by OTP to log in).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM site_settings WHERE key = 'migrated_has_password') THEN
    UPDATE users SET has_password = false WHERE role = 'customer' AND username ~ '^m[6-9][0-9]{9}(_[0-9]+)?$';
    INSERT INTO site_settings (key, value) VALUES ('migrated_has_password', current_date::text);
  END IF;
END $$;

-- Remove an agent (any status). Not while they still carry an order: finish or reassign it first.
CREATE OR REPLACE PROCEDURE sp_remove_agent(p_agent_id INT, p_reason TEXT, p_admin_id INT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
  v_open INT;
BEGIN
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Please give a reason for removing this agent' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_open FROM orders WHERE agent_id = p_agent_id AND status IN ('assigned', 'picked_up');
  IF v_open > 0 THEN
    RAISE EXCEPTION 'This agent still has % order(s) in progress. Finish or reassign them first.', v_open USING ERRCODE = '55000';
  END IF;
  UPDATE agents
     SET status = 'removed', is_online = false, removed_reason = trim(p_reason), removed_at = now(), removed_by = p_admin_id
   WHERE user_id = p_agent_id AND status <> 'removed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found or already removed' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- Suspend / re-activate an agent, and bring back a removed one (unless the number now belongs to another agent).
CREATE OR REPLACE PROCEDURE sp_set_agent_status(p_agent_id INT, p_status TEXT)
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Status must be active or suspended' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'active' AND EXISTS (
       SELECT 1 FROM agents a JOIN users u ON u.id = a.user_id
        WHERE a.user_id = p_agent_id AND a.status = 'removed'
          AND EXISTS (SELECT 1 FROM agents b JOIN users w ON w.id = b.user_id
                       WHERE b.user_id <> a.user_id AND w.phone = u.phone AND b.status IN ('pending', 'active', 'suspended'))) THEN
    RAISE EXCEPTION 'Another agent account now uses this mobile number' USING ERRCODE = '55000';
  END IF;
  UPDATE agents
     SET status = p_status, is_online = CASE WHEN p_status = 'suspended' THEN false ELSE is_online END,
         removed_reason = CASE WHEN p_status = 'active' THEN NULL ELSE removed_reason END,
         removed_at = CASE WHEN p_status = 'active' THEN NULL ELSE removed_at END
   WHERE user_id = p_agent_id AND status IN ('active', 'suspended', 'removed')
     AND NOT (status = 'removed' AND p_status = 'suspended');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found' USING ERRCODE = 'P0002';
  END IF;
END $$;
