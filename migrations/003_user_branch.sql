-- Add branch_id to public.users (nullable, foreign key to branches.id)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch_id integer REFERENCES public.branches(id);
