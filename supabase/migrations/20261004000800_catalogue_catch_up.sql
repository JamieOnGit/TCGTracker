-- Fill the whole catalogue's pictures in about a day instead of a week:
-- the images job now runs every 6 hours (workers) and checks up to 12,000
-- image addresses per run (about 0.1 s each, in its own process).
update public.site_settings
   set value = '12000',
       description = 'Image addresses checked per images run (every 6 hours). Each is one quick request to the image host.'
 where key = 'images.max_image_checks_per_run' and value = '3000'::jsonb;
