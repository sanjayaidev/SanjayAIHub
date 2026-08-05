-- Add img column to prompt_library table
-- This stores the thumbnail/preview image URL for each prompt

ALTER TABLE prompt_library 
ADD COLUMN IF NOT EXISTS img TEXT;

-- Add index for faster queries if needed
CREATE INDEX IF NOT EXISTS idx_prompt_library_img ON prompt_library(img) WHERE img IS NOT NULL;
