CREATE TABLE IF NOT EXISTS public.tag (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(32) NOT NULL,
  description TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tag_code_format CHECK (
    code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'
  )
);

-- Case-insensitive uniqueness for tag.code (blocks DOA + doa)
CREATE UNIQUE INDEX IF NOT EXISTS tag_code_unique_ci
  ON public.tag (lower(code));

CREATE TABLE IF NOT EXISTS public.system_tag (
  system_id   INTEGER NOT NULL,
  tag_id      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INTEGER NULL,

  PRIMARY KEY (system_id, tag_id),

  CONSTRAINT system_tag_system_fk
    FOREIGN KEY (system_id) REFERENCES public.system(id) ON DELETE CASCADE,

  CONSTRAINT system_tag_tag_fk
    FOREIGN KEY (tag_id) REFERENCES public.tag(id) ON DELETE CASCADE,

  CONSTRAINT system_tag_created_by_fk
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_system_tag_tag_id ON public.system_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_system_tag_system_id ON public.system_tag(system_id);
