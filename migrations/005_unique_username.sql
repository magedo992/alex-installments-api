-- Enforce unique usernames so username-based login is unambiguous
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_key'
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);
  END IF;
END $$;
