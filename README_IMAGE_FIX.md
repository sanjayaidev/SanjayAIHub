# Fix for Images Not Loading in Prompt Library Preview

## Problem
Images from postimg.cc (e.g., `https://i.postimg.cc/NFF7qPtt/Screenshot-2026-08-05-151029.png`) were not loading in the prompt library preview, even though the links in the database were correct.

## Root Cause
The issue was caused by two factors:
1. **Missing `img` column in database**: The `prompt_library` table schema did not include an `img` column to store thumbnail/preview image URLs.
2. **Content Security Policy (CSP)**: The CSP `img-src` directive was too restrictive and didn't allow all external image sources.
3. **Missing CORS attributes**: Image tags didn't have `crossorigin="anonymous"` attribute for proper cross-origin requests.

## Solution

### 1. Database Schema Update
Added the `img` column to the `prompt_library` table:

**File: `/workspace/Tables.sql`** (line 135)
```sql
img TEXT, -- thumbnail/preview image URL for the prompt
```

**Migration file: `/workspace/migrations/add_img_column_to_prompt_library.sql`**
```sql
ALTER TABLE prompt_library 
ADD COLUMN IF NOT EXISTS img TEXT;

CREATE INDEX IF NOT EXISTS idx_prompt_library_img ON prompt_library(img) WHERE img IS NOT NULL;
```

Run this migration on your database:
```bash
psql -U your_user -d your_database -f /workspace/migrations/add_img_column_to_prompt_library.sql
```

### 2. Content Security Policy Update
Updated the CSP in `server.js` to allow images from all sources:

**File: `/workspace/server.js`** (line 89)
```javascript
imgSrc: ["'self'", "data:", "blob:", "picsum.photos", "https://picsum.photos", "i.postimg.cc", "https://i.postimg.cc", "*"],
```

Also added a relaxed referrer policy (line 69):
```javascript
referrerPolicy: { policy: ["no-referrer", "strict-origin-when-cross-origin"] },
```

### 3. Added CORS Attributes to Image Tags
Updated all `<img>` tags in the prompt library preview to include `crossorigin="anonymous"`:

**File: `/workspace/public/prompts.html`**
- Line 910: Thumbnail images in the list
- Line 912: Fallback video thumbnail
- Line 972: Preview media image
- Line 976: Fallback demo_url image

Example:
```html
<img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.headline)}" loading="lazy" crossorigin="anonymous" ... />
```

## Verification
After applying these changes:
1. Run the database migration to add the `img` column
2. Restart the server to apply CSP changes
3. Images from postimg.cc and other external sources should now load correctly in both the thumbnail list and the preview panel

## Files Modified
1. `/workspace/Tables.sql` - Added `img` column to schema
2. `/workspace/migrations/add_img_column_to_prompt_library.sql` - Migration script (new file)
3. `/workspace/server.js` - Updated CSP and referrer policy
4. `/workspace/public/prompts.html` - Added `crossorigin="anonymous"` to image tags
