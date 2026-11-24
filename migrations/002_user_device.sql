-- Nullable for pre-existing accounts; registration always supplies a device ID.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS device_id varchar(256);
